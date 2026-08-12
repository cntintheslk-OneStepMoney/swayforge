'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { MEDIA_INDEX_SCHEMA_VERSION } = require('./media-index-contracts.cjs');

const INDEX_FILENAME = 'index.json';
const MAX_DERIVED_TEXT = 240;
const MAX_DERIVED_ITEMS = 64;
const TOKEN_PATTERN = /[\p{L}\p{N}]+/gu;

function normaliseText(value, max = MAX_DERIVED_TEXT) {
  return typeof value === 'string' ? value.normalize('NFKC').trim().slice(0, max) : '';
}

function tokens(value) {
  return (normaliseText(value, 5000).toLocaleLowerCase().match(TOKEN_PATTERN) ?? []).filter(Boolean);
}

function durationBucket(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds < 15) return 'under-15s';
  if (seconds < 60) return '15-59s';
  if (seconds < 300) return '1-5m';
  return '5m-plus';
}

function orientation(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  if (width === height) return 'square';
  return width > height ? 'landscape' : 'portrait';
}

function cleanDerivedList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.slice(0, MAX_DERIVED_ITEMS).map((item) => normaliseText(item)).filter(Boolean))];
}

function cleanDerivedIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.slice(0, MAX_DERIVED_ITEMS).filter((item) => typeof item === 'string' && item.length > 0 && item.length <= 128))];
}

function canonicalDerived(derived = {}) {
  return {
    userTagIds: cleanDerivedIds(derived.userTagIds),
    userTags: cleanDerivedList(derived.userTags),
    collectionIds: cleanDerivedIds(derived.collectionIds),
    collectionNames: cleanDerivedList(derived.collectionNames),
    aiLabels: cleanDerivedList(derived.aiLabels),
    aiDescription: normaliseText(derived.aiDescription)
  };
}

function baseSourceFingerprint(media, projectIds) {
  const payload = JSON.stringify({
    id: media.id,
    originalFilename: media.originalFilename,
    fileSize: Number.isSafeInteger(media.fileSize) ? media.fileSize : null,
    kind: media.kind,
    width: media.width ?? null,
    height: media.height ?? null,
    durationSeconds: media.durationSeconds ?? null,
    importedAt: media.importedAt,
    availability: media.availability,
    projectIds: [...projectIds].sort()
  });
  return createHash('sha256').update(payload).digest('hex');
}

function sourceFingerprint(media, projectIds, derived = {}) {
  return createHash('sha256')
    .update(`${baseSourceFingerprint(media, projectIds)}:${JSON.stringify(canonicalDerived(derived))}`)
    .digest('hex');
}

function buildSearchText(entry) {
  return [entry.filenameStem, ...entry.userTags, ...entry.collectionNames, ...entry.aiLabels, entry.aiDescription]
    .filter(Boolean)
    .join(' ')
    .normalize('NFKC')
    .toLocaleLowerCase();
}

function freezeEntry(entry) {
  return Object.freeze({
    ...entry,
    projectIds: Object.freeze([...entry.projectIds]),
    userTagIds: Object.freeze([...entry.userTagIds]),
    userTags: Object.freeze([...entry.userTags]),
    collectionIds: Object.freeze([...entry.collectionIds]),
    collectionNames: Object.freeze([...entry.collectionNames]),
    aiLabels: Object.freeze([...entry.aiLabels])
  });
}

function serialisableEntry(entry) {
  const { searchText, ...rest } = entry;
  return rest;
}

function assertIndexDocument(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Index document must be an object.');
  if (value.schemaVersion !== MEDIA_INDEX_SCHEMA_VERSION) throw Object.assign(new Error('Media index schema is stale.'), { code: 'MEDIA_INDEX_SCHEMA_MISMATCH' });
  if (!Number.isSafeInteger(value.sourceRevision) || value.sourceRevision < 0 || !Array.isArray(value.entries)) throw new TypeError('Index document is invalid.');
  if (value.organisationFingerprint !== undefined && value.organisationFingerprint !== null && !/^[a-f0-9]{64}$/.test(value.organisationFingerprint)) {
    throw new TypeError('Index organisation fingerprint is invalid.');
  }
}

function createEntry(media, projectIds, derived = {}) {
  const filename = normaliseText(media.originalFilename, 512);
  const stem = normaliseText(path.parse(filename).name, 512);
  const cleanDerived = canonicalDerived(derived);
  const entry = {
    mediaId: media.id,
    filename,
    filenameStem: stem,
    filenameTokens: tokens(stem),
    fileSize: Number.isSafeInteger(media.fileSize) ? media.fileSize : null,
    kind: media.kind,
    width: Number.isFinite(media.width) ? media.width : null,
    height: Number.isFinite(media.height) ? media.height : null,
    orientation: orientation(media.width, media.height),
    durationSeconds: Number.isFinite(media.durationSeconds) ? media.durationSeconds : null,
    durationBucket: durationBucket(media.durationSeconds),
    importedAt: media.importedAt,
    availability: media.availability,
    projectIds: [...projectIds].sort(),
    exactDuplicateState: 'canonical',
    baseSourceFingerprint: baseSourceFingerprint(media, projectIds),
    sourceFingerprint: sourceFingerprint(media, projectIds, cleanDerived),
    ...cleanDerived,
    searchText: ''
  };
  entry.searchText = buildSearchText(entry);
  return freezeEntry(entry);
}

function compare(sort) {
  const stable = (a, b, primary) => primary || a.mediaId.localeCompare(b.mediaId);
  switch (sort) {
    case 'imported-asc': return (a, b) => stable(a, b, a.importedAt.localeCompare(b.importedAt));
    case 'filename-asc': return (a, b) => stable(a, b, a.filename.localeCompare(b.filename, undefined, { sensitivity: 'base' }));
    case 'filename-desc': return (a, b) => stable(a, b, b.filename.localeCompare(a.filename, undefined, { sensitivity: 'base' }));
    case 'kind-asc': return (a, b) => stable(a, b, a.kind.localeCompare(b.kind) || a.filename.localeCompare(b.filename, undefined, { sensitivity: 'base' }));
    case 'duration-asc': return (a, b) => stable(a, b, (a.durationSeconds ?? Infinity) - (b.durationSeconds ?? Infinity));
    case 'duration-desc': return (a, b) => stable(a, b, (b.durationSeconds ?? -1) - (a.durationSeconds ?? -1));
    default: return (a, b) => stable(a, b, b.importedAt.localeCompare(a.importedAt));
  }
}

class MediaIndexService {
  static async open(options) {
    const service = new MediaIndexService(options);
    await service.initialise();
    return service;
  }

  constructor({ rootDirectory, repository, derivedMetadataProviders = [] } = {}) {
    if (typeof rootDirectory !== 'string' || !path.isAbsolute(rootDirectory)) throw new TypeError('rootDirectory must be an absolute trusted path.');
    if (!repository || typeof repository.listMedia !== 'function' || typeof repository.getStorageSummary !== 'function') throw new TypeError('repository is invalid.');
    if (!Array.isArray(derivedMetadataProviders) || derivedMetadataProviders.some((provider) => typeof provider !== 'function')) throw new TypeError('derivedMetadataProviders is invalid.');
    this.rootDirectory = path.resolve(rootDirectory);
    this.indexPath = path.join(this.rootDirectory, INDEX_FILENAME);
    this.repository = repository;
    this.derivedMetadataProviders = [...derivedMetadataProviders];
    this.sourceRevision = -1;
    this.organisationFingerprint = null;
    this.entries = new Map();
    this.lastRebuildReason = 'not-initialised';
    this.lastSyncChangedCount = 0;
    this.refreshPromise = null;
  }

  async initialise() {
    await fs.mkdir(this.rootDirectory, { recursive: true, mode: 0o700 });
    try {
      const parsed = JSON.parse(await fs.readFile(this.indexPath, 'utf8'));
      assertIndexDocument(parsed);
      this.sourceRevision = parsed.sourceRevision;
      this.organisationFingerprint = parsed.organisationFingerprint ?? null;
      this.entries = new Map(parsed.entries.map((raw) => {
        const entry = freezeEntry({ ...raw, searchText: buildSearchText(raw) });
        return [entry.mediaId, entry];
      }));
      this.lastRebuildReason = 'loaded';
      this.lastSyncChangedCount = 0;
    } catch (error) {
      if (error?.code !== 'ENOENT') if (error?.code !== 'ENOENT') {
        await this.quarantineBrokenIndex().catch(() => {});
      }
      await this.rebuild(error?.code === 'MEDIA_INDEX_SCHEMA_MISMATCH' ? 'schema-mismatch' : 'missing-or-corrupt');
      return;
    }
    await this.refreshIfStale();
  }

  async quarantineBrokenIndex() {
    const destination = path.join(this.rootDirectory,  index.corrupt-${Date.now()}-${randomUUID()}.json`);
    await fs.rename(this.indexPath, destination).catch((error) => { if (error?.code !== 'ENOENT')›ЭИ\њ›ЬЋИJNВ€B‚€\Ю[И™XY›Ъ™XЭ™Y™\™[Щ\К
HВ€ЫЫњЭЭ]]H™]ИX\

NВ€Y€
\[Щ€\Лњ™\ЬЪ]ЬћK›\Э›Ъ™XЭИOOH	Щќ[Э[Ы‰И\[Щ€\Лњ™\ЬЪ]ЬћKњ™XY›Ъ™XЭOOH	Щќ[Э[Ы‰КH™]\›€Э]]В€ЫЫњЭ›Ъ™XЭИH]ШZ]\Лњ™\ЬЪ]ЬћK›\Э›Ъ™XЭК
NВ€›Ь€
ЫЫњЭЭ[[X\ћHЩ€›Ъ™XЭЛњ›Ъ™XЭИПИЧJHВ€ЫЫњЭ]Z[H]ШZ]\Лњ™\ЬЪ]ЬћKњ™XY›Ъ™XЭ
И›Ъ™XЭY€Э[[X\ћKљYJNВ€›Ь€
ЫЫњЭYYXRYЩ€]Z[њ›Ъ™XЭЛ›YYXRYИПИЧJHВ€Y€
[Э]]љ\КYYXRY
JHЭ]]њЩ]
YYXRYЧJNВ€Э]]™Щ]
YYXRY
Kњ\Ъ
Э[[X\ћKљY
NВ€B€B€™]\›€Э]]В€B‚€\Ю[ИЩ]Ь™Ш[љ\Ш][Ы‘љ[™Щ\њљ[ќ

HВ€Y€
\[Щ€\Лњ™\ЬЪ]ЬћKњ™XYYYXSЬ™Ш[љ\Ш][Ы€OOH	Щќ[Э[Ы‰КH™]\›€ќ[В€ЫЫњЭЫ\ЪЭH]ШZ]\Лњ™\ЬЪ]ЬћKњ™XYYYXSЬ™Ш[љ\Ш][ЫЉ
NВ€™]\›€Ь™X]R\Ъ
	ЬЪLЌM‰КKќ\]J”УУ‹њЭљ[™ЪYћJЫ\ЪЭЛ›Ь™Ш[љ\Ш][Ы€ПИќ[
JK™YЩ\Э
	Ъ^	КNВ€B‚€\Ю[ИЩ]\љ]™YY]Y]JYYXJHВ€ЫЫњЭY\™ЩYHЯNВ€›Ь€
ЫЫњЭ›ЭљY\€Щ€\Л™\љ]™YY]Y]T›ЭљY\њКHВ€ЫЫњЭ[YHH]ШZ]›ЭљY\ЉYYXJNВ€Y€
][YH\[Щ€[YHOOH	ЫШљ™XЭ	И\њ^Kљ\Р\њ^J[YJJHЫЫќ[ќYNВ€›Ь€
ЫЫњЭЩ^HЩ€ЙЭ\Щ\•YТYЙЛ	Э\Щ\•YЬЙЛ	ШЫЫXЭ[Ы’YЙЛ	ШЫЫXЭ[Ы“[Y\ЙЛ	ШZSX™[ЙЛ	ШZQ\ШЬљ\[Ы‰ЧJHВ€Y€
Шљ™XЭљ\УЭЫЉ[YKЩ^JJHY\™ЩYЪЩ^WHH[YVЪЩ^WNВ€B€B€™]\›€Y\™ЩYВ€B‚€\Ю[И™XќZ[
™X\ЫЫ€H	Щ^XЪ]	КHВ€™]\›€\ЛњЮ[Ъ›Ыљ\ЩJИ›ЬЩT™XќZ[€ќYK™X\ЫЫ€JNВ€B‚€\Ю[ИЮ[Ъ›Ыљ\ЩJИ›ЬЩT™XќZ[H[ЩK™X\ЫЫ€H	ЬЫЭ\ЩK\™]љ\Ъ[Ы‹XЪ[™ЩY	ИHHЯJHВ€Y€
\Лњ™Yњ™\Ъ›ЫZ\ЩJH™]\›€\Лњ™Yњ™\Ъ›ЫZ\ЩNВ€\Лњ™Yњ™\Ъ›ЫZ\ЩHH
\Ю[И

HO€В€ЫЫњЭYYXTЫ\ЪЭH]ШZ]\Лњ™\ЬЪ]ЬћK›\ЭYYXJ
NВ€ЫЫњЭ›Ъ™XЭ™Y™\™[Щ\ИH]ШZ]\Лњ™XY›Ъ™XЭ™Y™\™[Щ\К
NВ€ЫЫњЭЬ™Ш[љ\Ш][Ы‘љ[™Щ\њљ[ќH]ШZ]\Л™Щ]Ь™Ш[љ\Ш][Ы‘љ[™Щ\њљ[ќ

NВ€ЫЫњЭ\љ]™Y[ќ[Y]YH›ЬЩT™XќZ[Ь™Ш[љ\Ш][Ы‘љ[™Щ\њљ[ќOOH\Л›Ь™Ш[љ\Ш][Ы‘љ[™Щ\њљ[ќВ€ЫЫњЭ™^H™]ИX\

NВ€]Ъ[™ЩYЫЭ[ќHВ€›Ь€
ЫЫњЭYYXHЩ€YYXTЫ\ЪЭ›YYXHПИЧJHВ€ЫЫњЭ›Ъ™XЭYИH›Ъ™XЭ™Y™\™[Щ\Л™Щ]
YYXKљY
HПИЧNВ€ЫЫњЭ\ЩQљ[™Щ\њљ[ќH\ЩTЫЭ\ЩQљ[™Щ\њљ[ќ
YYXK›Ъ™XЭYКNВ€ЫЫњЭ^\Э[™ИH\Л™[ќљY\Л™Щ]
YYXKљY
NВ€Y€
Y\љ]™Y[ќ[Y]Y	‰€^\Э[™ПЛ\ЩTЫЭ\ЩQљ[™Щ\њљ[ќOOH\ЩQљ[™Щ\њљ[ќ
HВ€™^њЩ]
YYXKљY^\Э[™КNВ€ЫЫќ[ќYNВ€B€ЫЫњЭ\љ]™YH]ШZ]\Л™Щ]\љ]™YY]Y]JYYXJNВ€ЫЫњЭ[ќћHHЬ™X]Q[ќћJYYXK›Ъ™XЭYЛ\љ]™Y
NВ€™^њЩ]
[ќћK›YYXRY[ќћJNВ€Ъ[™ЩYЫЭ[ќ
ПHNВ€B€›Ь€
ЫЫњЭYYXRYЩ€\Л™[ќљY\ЛљЩ^\К
JHY€
[™^љ\КYYXRY
JHЪ[™ЩYЫЭ[ќ
ПHNВ€\Л™[ќљY\ИH™^В€\ЛњЫЭ\ЩT™]љ\Ъ[Ы€HYYXTЫ\ЪЭњЭЬ™T™]љ\Ъ[ЫЋВ€\Л›Ь™Ш[љ\Ш][Ы‘љ[™Щ\њљ[ќHЬ™Ш[љ\Ш][Ы‘љ[™Щ\њљ[ќВ€\Л›\Э™XќZ[™X\ЫЫ€H™X\ЫЫЋВ€\Л›\ЭЮ[РЪ[™ЩYЫЭ[ќHЪ[™ЩYЫЭ[ќВ€]ШZ]\Лњ\њЪ\Э

NВ€™]\›€\Л™Щ]Э]\К
NВ€JJ
K™љ[[J

HO€И\Лњ™Yњ™\Ъ›ЫZ\ЩHHќ[ИJNВ€™]\›€\Лњ™Yњ™\Ъ›ЫZ\ЩNВ€B‚€\Ю[И™Yњ™\ЪY”Э[J
HВ€ЫЫњЭ™]љ\Ъ[Ы€H\Лњ™\ЬЪ]ЬћK™Щ]ЭЬYЩTЭ[[X\ћJ
Kњ™]љ\Ъ[ЫЋВ€Y€
™]љ\Ъ[Ы€OOH\ЛњЫЭ\ЩT™]љ\Ъ[ЫЉH™]\›€[ЩNВ€]ШZ]\ЛњЮ[Ъ›Ыљ\ЩJИ™X\ЫЫЋ€	ЬЫЭ\ЩK\™]љ\Ъ[Ы‹XЪ[™ЩY	ИJNВ€™]\›€ќYNВ€B‚€\Ю[И\њЪ\Э

HВ€ЫЫњЭШЭ[Y[ќHВ€ШЪ[XU™\њЪ[ЫЋ€QQPWТS‘VФРТSPWХ‘T”ТSУ‹€ЫЭ\ЩT™]љ\Ъ[ЫЋ€\ЛњЫЭ\ЩT™]љ\Ъ[Ы‹€Ь™Ш[љ\Ш][Ы‘љ[™Щ\њљ[ќ€\Л›Ь™Ш[љ\Ш][Ы‘љ[™Щ\њљ[ќ€[ќљY\О€Л‹‹ќ\Л™[ќљY\Лќ[Y\К
WKњЫЬќ

KЉHO€K›YYXRY›ШШ[PЫЫ\\™J‹›YYXRY
JK›X\
Щ\љX[\ШX›Q[ќћJB€NВ€ЫЫњЭЭYЪ[™ИH	Э\Лљ[™^]KњЭYЪ[™ЛIЬ›ШЩ\ЬЛњYKIЬ[™ЫUURQ

_XВ€]ШZ]њЛќЬљ]Qљ[JЭYЪ[™Л	Т”УУ‹њЭљ[™ЪYћJШЭ[Y[ќќ[Љ_WИ[ЩN€НЊ›YО€	ЭЮ	ИJNВ€]ШZ]њЛњ™[[YJЭYЪ[™Л\Лљ[™^]
NВ€B‚€Щ]Э]\К
HВ€™]\›€Шљ™XЭ™њ™Y^™JВ€ШЪ[XU™\њЪ[ЫЋ€QQPWТS‘VФРТSPWХ‘T”ТSУ‹€ЫЭ\ЩT™]љ\Ъ[ЫЋ€\ЛњЫЭ\ЩT™]љ\Ъ[Ы‹€[ќћPЫЭ[ќ€\Л™[ќљY\ЛњЪ^™K€Э]N€	Ь™XYIЛ€™XќZ[X›N€ќYK€ШШ[Ы›N€ќYK€\Э™XќZ[™X\ЫЫЋ€\Л›\Э™XќZ[™X\ЫЫ‹€\ЭЮ[РЪ[™ЩYЫЭ[ќ€\Л›\ЭЮ[РЪ[™ЩYЫЭ[ќ€JNВ€B‚€X]ЪЫЭ\Щ\К[ќћK]Y\ћUЪЩ[њКHВ€Y€
]Y\ћUЪЩ[њЛ›[™ЭOOH
H™]\›€ЧNВ€Y€
\]Y\ћUЪЩ[њЛ™]™\ћJ
ЪЩ[ЉHO€[ќћKњЩX\Ъ^љ[ЫY\КЪЩ[ЉJJH™]\›€ќ[В€ЫЫњЭЫЭ\Щ\ИHЧNВ€Y€
]Y\ћUЪЩ[њЛњЫЫYJ
ЪЩ[ЉHO€[ќћK™љ[[[YTЭ[KќУШШ[SЭЩ\ђШ\ЩJ
Kљ[ЫY\КЪЩ[ЉJJHЫЭ\Щ\Лњ\Ъ
	Щљ[[[YIКNВ€Y€
]Y\ћUЪЩ[њЛњЫЫYJ
ЪЩ[ЉHO€[ќћKќ\Щ\•YЬЛљ›Ъ[Љ	И	КKќУШШ[SЭЩ\ђШ\ЩJ
Kљ[ЫY\КЪЩ[ЉJJHЫЭ\Щ\Лњ\Ъ
	Э\Щ\‹]YЙКNВ€Y€
]Y\ћUЪЩ[њЛњЫЫYJ
ЪЩ[ЉHO€[ќћKЫЫXЭ[Ы“[Y\Лљ›Ъ[Љ	И	КKќУШШ[SЭЩ\ђШ\ЩJ
Kљ[ЫY\КЪЩ[ЉJJHЫЭ\Щ\Лњ\Ъ
	ШЫЫXЭ[Ы‰КNВ€Y€
]Y\ћUЪЩ[њЛњЫЫYJ
ЪЩ[ЉHO€Л‹‹™[ќћKZSX™[Л[ќћKZQ\ШЬљ\[Ы—Kљ›Ъ[Љ	И	КKќУШШ[SЭЩ\ђШ\ЩJ
Kљ[ЫY\КЪЩ[ЉJJHЫЭ\Щ\Лњ\Ъ
	ШZK[X™[	КNВ€™]\›€ЫЭ\Щ\ОВ€B‚€\Ю[ИЩX\Ъ
™\]Y\Э
HВ€]ШZ]\Лњ™Yњ™\ЪY”Э[J
NВ€ЫЫњЭ]Y\ћUЪЩ[њИHЪЩ[њК™\]Y\Эњ]Y\ћJNВ€]][\ИHЧNВ€›Ь€
ЫЫњЭ[ќћHЩ€\Л™[ќљY\Лќ[Y\К
JHВ€Y€
™\]Y\ЭќYТYПЛ›[™Э	‰€\™\]Y\ЭќYТYЛ™]™\ћJ
YТY
HO€[ќћKќ\Щ\•YТYЛљ[ЫY\КYТY
JJHЫЫќ[ќYNВ€Y€
™\]Y\ЭЫЫXЭ[Ы’Y	‰€Y[ќћKЫЫXЭ[Ы’YЛљ[ЫY\К™\]Y\ЭЫЫXЭ[Ы’Y
JHЫЫќ[ќYNВ€Y€
™\]Y\Э›YYXRЪ[™	‰€[ќћKљЪ[™OOH™\]Y\Э›YYXRЪ[™
HЫЫќ[ќYNВ€Y€
™\]Y\Э]Z[Xљ[]H	‰€[ќћK]Z[Xљ[]HOOH™\]Y\Э]Z[Xљ[]JHЫЫќ[ќYNВ€Y€
™\]Y\Э›ЬљY[ќ][Ы€	‰€[ќћK›ЬљY[ќ][Ы€OOH™\]Y\Э›ЬљY[ќ][ЫЉHЫЫќ[ќYNВ€Y€
™\]Y\Эљ[\ЬќYYќ\€	‰€[ќћKљ[\ЬќY]™\]Y\Эљ[\ЬќYYќ\ЉHЫЫќ[ќYNВ€Y€
™\]Y\Эљ[\ЬќY™Y›Ь™H	‰€[ќћKљ[\ЬќY]€™\]Y\Эљ[\ЬќY™Y›Ь™JHЫЫќ[ќYNВ€Y€
™\]Y\Э›Z[‘\][Ы”ЩXЫЫ™ИOOHќ[	‰€
[ќћK™\][Ы”ЩXЫЫ™ИOOHќ[[ќћK™\][Ы”ЩXЫЫ™И™\]Y\Э›Z[‘\][Ы”ЩXЫЫ™КJHЫЫќ[ќYNВ€Y€
™\]Y\Э›X^\][Ы”ЩXЫЫ™ИOOHќ[	‰€
[ќћK™\][Ы”ЩXЫЫ™ИOOHќ[[ќћK™\][Ы”ЩXЫЫ™И€™\]Y\Э›X^\][Ы”ЩXЫЫ™КJHЫЫќ[ќYNВ€Y€
™\]Y\Э›Z[•ЪYOOHќ[	‰€
[ќћKќЪYOOHќ[[ќћKќЪY™\]Y\Э›Z[•ЪY
JHЫЫќ[ќYNВ€Y€
™\]Y\Э›X^ЪYOOHќ[	‰€
[ќћKќЪYOOHќ[[ќћKќЪY€™\]Y\Э›X^ЪY
JHЫЫќ[ќYNВ€Y€
™\]Y\Э›Z[’ZYЪOOHќ[	‰€
[ќћKљZYЪOOHќ[[ќћKљZYЪ™\]Y\Э›Z[’ZYЪ
JHЫЫќ[ќYNВ€Y€
™\]Y\Э›X^ZYЪOOHќ[	‰€
[ќћKљZYЪOOHќ[[ќћKљZYЪ€™\]Y\Э›X^ZYЪ
JHЫЫќ[ќYNВ€ЫЫњЭX]ЪЫЭ\Щ\ИH\Л›X]ЪЫЭ\Щ\К[ќћK]Y\ћUЪЩ[њКNВ€Y€
X]ЪЫЭ\Щ\ИOOHќ[
HЫЫќ[ќYNВ€][\Лњ\Ъ
И[ќћKX]ЪЫЭ\Щ\ИJNВ€B€][\ЛњЫЬќ

KЉHO€ЫЫ\\™J™\]Y\ЭњЫЬќ
JK™[ќћK‹™[ќћJJNВ€ЫЫњЭЭ[H][\Л›[™ЭВ€][\ИH][\ЛњЫXЩJ™\]Y\Э›Щ™њЩ]™\]Y\Э›Щ™њЩ]
И™\]Y\Э›[Z]
K›X\

И[ќћKX]ЪЫЭ\Щ\ИJHO€Шљ™XЭ™њ™Y^™JВ€Y€[ќћK›YYXRY€Ъ[™€[ќћKљЪ[™€ЬљYЪ[[љ[[[YN€[ќћK™љ[[[YK€љ[TЪ^™N€[ќћK™љ[TЪ^™K€ЪY€[ќћKќЪY€ZYЪ€[ќћKљZYЪ€ЬљY[ќ][ЫЋ€[ќћK›ЬљY[ќ][Ы‹€\][Ы”ЩXЫЫ™О€[ќћK™\][Ы”ЩXЫЫ™Л€\][ЫђќXЪЩ]€[ќћK™\][ЫђќXЪЩ]€[\ЬќY]€[ќћKљ[\ЬќY]€]Z[Xљ[]N€[ќћK]Z[Xљ[]K€›Ъ™XЭYО€Шљ™XЭ™њ™Y^™JЛ‹‹™[ќћKњ›Ъ™XЭYЧJK€\Щ\•YТYО€Шљ™XЭ™њ™Y^™JЛ‹‹™[ќћKќ\Щ\•YТYЧJK€\Щ\•YЬО€Шљ™XЭ™њ™Y^™JЛ‹‹™[ќћKќ\Щ\•YЬЧJK€ЫЫXЭ[Ы’YО€Шљ™XЭ™њ™Y^™JЛ‹‹™[ќћKЫЫXЭ[Ы’YЧJK€ЫЫXЭ[Ы“[Y\О€Шљ™XЭ™њ™Y^™JЛ‹‹™[ќћKЫЫXЭ[Ы“[Y\ЧJK€^XЭ\XШ]TЭ]N€[ќћK™^XЭ\XШ]TЭ]K€X]ЪЫЭ\Щ\О€Шљ™XЭ™њ™Y^™JЛ‹‹›X]ЪЫЭ\Щ\ЧJB€JJNВ€™]\›€Шљ™XЭ™њ™Y^™JВ€ЫЭ\ЩT™]љ\Ъ[ЫЋ€\ЛњЫЭ\ЩT™]љ\Ъ[Ы‹€Э[€Щ™њЩ]€™\]Y\Э›Щ™њЩ]€[Z]€™\]Y\Э›[Z]€\У[Ь™N€™\]Y\Э›Щ™њЩ]
И][\Л›[™ЭЭ[€][\О€Шљ™XЭ™њ™Y^™J][\КB€JNВ€BџB‚›[Щ[K™^ЬќИHВ€YYXR[™^Щ\ќљXЩK€Ш[›ЫљXШ[\љ]™Y€Ь™X]Q[ќћK€\][ЫђќXЪЩ]€ЬљY[ќ][Ы‹€ЫЭ\ЩQљ[™Щ\њљ[ќ€ЪЩ[њВџNВ