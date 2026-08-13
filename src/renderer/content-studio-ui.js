'use strict';

(function attachContentStudio(root) {
  if (!root?.document) return;
  const state = { bridge: null, view: null, projectId: null, storeRevision: null, contentRevision: null, media: [] };

  function unwrap(result, fallback) {
    if (!result || result.ok !== true) throw new Error(result?.error?.message || fallback);
    return result.value;
  }
  function el(tag, options = {}) {
    const node = document.createElement(tag);
    if (options.className) node.className = options.className;
    if (options.text != null) node.textContent = options.text;
    for (const [name, value] of Object.entries(options.attrs || {})) node.setAttribute(name, value);
    return node;
  }
  function field(label, control) {
    const wrapper = el('label', { className: 'content-field' });
    wrapper.append(el('span', { text: label }), control);
    return wrapper;
  }
  function option(value, label) { const node = el('option', { text: label }); node.value = value; return node; }
  function injectStyles() {
    if (document.querySelector('link[data-content-studio-style]')) return;
    const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = './content-studio.css'; link.dataset.contentStudioStyle = 'true'; document.head.append(link);
  }
  function enableCreateNav() {
    const button = document.querySelector('[data-route="create"]');
    if (!button) return;
    button.disabled = false; button.removeAttribute('aria-disabled'); button.classList.remove('nav-item--future');
    const meta = button.querySelector('.nav-meta'); if (meta) meta.textContent = 'v0.3';
  }
  function buildView() {
    if (document.querySelector('#view-create')) return document.querySelector('#view-create');
    const view = el('section', { className: 'view content-studio', attrs: { id: 'view-create', 'data-view': 'create', 'aria-labelledby': 'page-heading', hidden: '' } });
    const head = el('div', { className: 'section-heading' });
    const intro = el('div'); intro.append(el('p', { className: 'eyebrow', text: 'Local Content Studio' }), el('h3', { text: 'Creative brief' }), el('p', { text: 'Create and edit local content projects. Media IDs and project revisions remain authoritative; no social account connection is implied.' }));
    const controls = el('div', { className: 'button-group' });
    const fresh = el('button', { className: 'button button--secondary', text: 'New project', attrs: { type: 'button', id: 'content-new-project' } });
    const archive = el('button', { className: 'button button--quiet', text: 'Archive', attrs: { type: 'button', id: 'content-archive-project', disabled: '' } });
    controls.append(fresh, archive); head.append(intro, controls); view.append(head);

    const status = el('p', { className: 'content-status', text: 'Loading local Content Studio…', attrs: { id: 'content-status', role: 'status' } }); view.append(status);
    const layout = el('div', { className: 'content-layout' });
    const form = el('form', { className: 'content-panel content-brief-form', attrs: { id: 'content-brief-form' } });
    const selector = el('select', { attrs: { id: 'content-project-selector' } }); selector.append(option('', 'Choose a project…'));
    form.append(field('Open local project', selector));
    const title = el('input', { attrs: { id: 'content-title', maxlength: '160', required: '', placeholder: 'Project title' } });
    const goal = el('textarea', { attrs: { id: 'content-goal', maxlength: '2000', rows: '3', placeholder: 'What should this content achieve?' } });
    const format = el('select', { attrs: { id: 'content-format' } }); [['short-form-video','Short-form video'],['image','Image'],['carousel','Carousel concept']].forEach(([v,l])=>format.append(option(v,l)));
    const platform = el('select', { attrs: { id: 'content-platform' } }); [['generic','Generic'],['tiktok','TikTok intent'],['instagram-reel','Instagram Reel intent'],['youtube-short','YouTube Short intent']].forEach(([v,l])=>platform.append(option(v,l)));
    const duration = el('input', { attrs: { id: 'content-duration', type: 'number', min: '1', max: '3600', step: '1', placeholder: 'Optional' } });
    const aspect = el('select', { attrs: { id: 'content-aspect' } }); ['9:16','1:1','16:9','4:5'].forEach((v)=>aspect.append(option(v,v)));
    const exportGoal = el('input', { attrs: { id: 'content-export-goal', maxlength: '5000', placeholder: 'e.g. local vertical draft' } });
    const tone = el('textarea', { attrs: { id: 'content-tone', maxlength: '5000', rows: '2', placeholder: 'Tone/style notes' } });
    const instructions = el('textarea', { attrs: { id: 'content-instructions', maxlength: '5000', rows: '3', placeholder: 'Optional creator instructions' } });
    const caption = el('textarea', { attrs: { id: 'content-caption-notes', maxlength: '5000', rows: '2', placeholder: 'Caption notes' } });
    const script = el('textarea', { attrs: { id: 'content-script-notes', maxlength: '5000', rows: '2', placeholder: 'Script notes' } });
    form.append(field('Title', title), field('Goal', goal));
    const compact = el('div', { className: 'content-grid' }); compact.append(field('Format', format), field('Platform intent', platform), field('Desired duration (seconds)', duration), field('Aspect ratio', aspect)); form.append(compact);
    form.append(field('Export goal', exportGoal), field('Tone / style', tone), field('Creator instructions', instructions), field('Caption notes', caption), field('Script notes', script));
    form.append(el('h4', { text: 'Selected local media' }));
    form.append(el('div', { className: 'content-media-list', attrs: { id: 'content-media-list', role: 'group', 'aria-label': 'Selected local media' } }));
    const actions = el('div', { className: 'content-actions' });
    const save = el('button', { className: 'button button--primary', text: 'Create project', attrs: { type: 'submit', id: 'content-save-project' } });
    const revision = el('span', { className: 'card-meta', text: 'Unsaved draft', attrs: { id: 'content-revision' } }); actions.append(save, revision); form.append(actions);

    const stages = el('aside', { className: 'content-panel content-stage-panel' }); stages.append(el('h4', { text: 'Creation stages' }));
    [['Brief','Available now'],['AI writing','Issue #25'],['Storyboard','Issue #26'],['Timeline','Issue #27'],['Render & export','Issues #28–#32']].forEach(([name,meta],index)=>{const row=el('div',{className:`content-stage ${index===0?'is-current':''}`});row.append(el('strong',{text:name}),el('span',{text:meta}));stages.append(row);});
    layout.append(form, stages); view.append(layout); document.querySelector('#main-content').append(view); return view;
  }

  function values() {
    const selected = Array.from(document.querySelectorAll('#content-media-list input[type="checkbox"]:checked')).map((input)=>input.value);
    const durationRaw = document.querySelector('#content-duration').value;
    return {
      title: document.querySelector('#content-title').value.trim(),
      mediaIds: selected,
      brief: {
        goal: document.querySelector('#content-goal').value,
        format: document.querySelector('#content-format').value,
        platformIntent: document.querySelector('#content-platform').value,
        desiredDurationSeconds: durationRaw ? Number(durationRaw) : null,
        aspectRatio: document.querySelector('#content-aspect').value,
        exportGoal: document.querySelector('#content-export-goal').value,
        toneStyleNotes: document.querySelector('#content-tone').value,
        userInstructions: document.querySelector('#content-instructions').value,
        selectedMediaIds: selected,
        preferredMediaIds: [], requiredMediaIds: [], excludedMediaIds: [],
        captionNotes: document.querySelector('#content-caption-notes').value,
        scriptNotes: document.querySelector('#content-script-notes').value
      }
    };
  }
  function setStatus(message, error = false) { const node = document.querySelector('#content-status'); if (!node) return; node.textContent = message; node.classList.toggle('is-error', error); }
  function renderMedia(selected = []) {
    const rootNode = document.querySelector('#content-media-list'); rootNode.replaceChildren();
    if (!state.media.length) { rootNode.append(el('p', { className: 'card-meta', text: 'No managed media yet. Import media from the Media page first.' })); return; }
    for (const media of state.media) {
      const label = el('label', { className: 'content-media-option' }); const checkbox = el('input', { attrs: { type: 'checkbox' } }); checkbox.value = media.id; checkbox.checked = selected.includes(media.id);
      const text = el('span'); text.append(el('strong', { text: media.originalFilename || media.id }), el('small', { text: `${media.kind || 'media'} · ${media.availability || 'unknown'}` })); label.append(checkbox, text); rootNode.append(label);
    }
  }
  function clearForm() {
    state.projectId = null; state.storeRevision = null; state.contentRevision = null;
    document.querySelector('#content-brief-form').reset(); document.querySelector('#content-aspect').value = '9:16'; document.querySelector('#content-format').value = 'short-form-video'; document.querySelector('#content-platform').value = 'generic';
    renderMedia([]); document.querySelector('#content-save-project').textContent = 'Create project'; document.querySelector('#content-archive-project').disabled = true; document.querySelector('#content-revision').textContent = 'Unsaved draft'; document.querySelector('#content-project-selector').value = ''; setStatus('New local project draft.');
  }
  function loadContent(value) {
    state.projectId = value.project.id; state.storeRevision = value.storeRevision; state.contentRevision = value.content.revision;
    const brief = value.content.brief; document.querySelector('#content-title').value = brief.title; document.querySelector('#content-goal').value = brief.goal; document.querySelector('#content-format').value = brief.format; document.querySelector('#content-platform').value = brief.platformIntent; document.querySelector('#content-duration').value = brief.desiredDurationSeconds ?? ''; document.querySelector('#content-aspect').value = brief.aspectRatio; document.querySelector('#content-export-goal').value = brief.exportGoal; document.querySelector('#content-tone').value = brief.toneStyleNotes; document.querySelector('#content-instructions').value = brief.userInstructions; document.querySelector('#content-caption-notes').value = brief.captionNotes; document.querySelector('#content-script-notes').value = brief.scriptNotes; renderMedia(brief.selectedMediaIds);
    document.querySelector('#content-save-project').textContent = 'Save project'; document.querySelector('#content-archive-project').disabled = false; document.querySelector('#content-revision').textContent = `Project revision ${value.content.revision} · store ${value.storeRevision}`; document.querySelector('#content-project-selector').value = state.projectId; setStatus('Project loaded from local storage.');
  }
  async function refreshLists() {
    if (!state.bridge) return;
    const [projectsPayload, mediaPayload] = await Promise.all([
      state.bridge.listContentProjects().then((r)=>unwrap(r,'Projects could not be loaded.')),
      state.bridge.listMedia().then((r)=>unwrap(r,'Media could not be loaded.'))
    ]);
    state.media = Array.isArray(mediaPayload?.media) ? mediaPayload.media : [];
    const selector = document.querySelector('#content-project-selector'); const chosen = state.projectId; selector.replaceChildren(option('', 'Choose a project…'));
    for (const project of projectsPayload?.projects || []) selector.append(option(project.id, `${project.title}${project.status === 'archived' ? ' (archived)' : ''}`));
    if (chosen) selector.value = chosen; if (!state.projectId) renderMedia([]);
  }
  async function openProject(projectId) {
    if (!projectId) { clearForm(); return; }
    setStatus('Loading project…');
    try { loadContent(unwrap(await state.bridge.getContentProject(projectId), 'Project could not be opened.')); }
    catch (error) { setStatus(error.message, true); }
  }
  async function submit(event) {
    event.preventDefault(); const input = values(); if (!input.title) { setStatus('A project title is required.', true); return; }
    const button = document.querySelector('#content-save-project'); button.disabled = true; setStatus(state.projectId ? 'Saving local project…' : 'Creating local project…');
    try {
      if (!state.projectId) {
        const created = unwrap(await state.bridge.createContentProject(input), 'Project could not be created.'); state.projectId = created.project.id; await refreshLists(); await openProject(state.projectId);
      } else {
        unwrap(await state.bridge.updateContentProject({ projectId: state.projectId, expectedStoreRevision: state.storeRevision, expectedContentRevision: state.contentRevision, patch: { brief: { ...input.brief, title: input.title } } }), 'Project could not be saved.'); await refreshLists(); await openProject(state.projectId);
      }
      setStatus('Saved locally.');
    } catch (error) { setStatus(error.message, true); }
    finally { button.disabled = false; }
  }
  async function archive() {
    if (!state.projectId || state.storeRevision == null) return;
    const button = document.querySelector('#content-archive-project'); button.disabled = true; setStatus('Archiving project…');
    try { unwrap(await state.bridge.archiveContentProject(state.projectId, state.storeRevision), 'Project could not be archived.'); await refreshLists(); clearForm(); setStatus('Project archived. Source media was not deleted.'); }
    catch (error) { setStatus(error.message, true); button.disabled = false; }
  }
  function bind() {
    document.querySelector('#content-brief-form').addEventListener('submit', submit);
    document.querySelector('#content-project-selector').addEventListener('change', (event)=>openProject(event.target.value));
    document.querySelector('#content-new-project').addEventListener('click', clearForm);
    document.querySelector('#content-archive-project').addEventListener('click', archive);
  }
  async function activate(bridge) {
    state.bridge = bridge || state.bridge; if (!state.bridge) return;
    if (!state.view) { injectStyles(); enableCreateNav(); state.view = buildView(); bind(); }
    try { await refreshLists(); if (state.projectId) await openProject(state.projectId); else setStatus('Ready. Create a new project or open an existing local project.'); }
    catch (error) { setStatus(error.message, true); }
  }

  injectStyles(); enableCreateNav(); state.view = buildView(); bind();
  root.SwayForgeContentStudio = Object.freeze({ activate });
})(globalThis);
