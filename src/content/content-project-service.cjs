'use strict';
const { CONTENT_PROJECT_EXTENSION_KEY, createContentProject, migrateGenericProject, updateContentProject, validateContentProject } = require('./content-project-contracts.cjs');

class ContentProjectService {
  constructor({ repository }) { if (!repository) throw new TypeError('repository is required.'); this.repository = repository; }
  async #mediaCatalog() { const result = await this.repository.listMedia(); return result.media || []; }
  async create({ expectedRevision, title, mediaIds = [], brief = {} }) {
    const mediaCatalog = await this.#mediaCatalog(); const content = createContentProject({ title, mediaIds, brief, mediaCatalog });
    return this.repository.createProject({ expectedRevision, title, mediaIds, extensions: { [CONTENT_PROJECT_EXTENSION_KEY]: content } });
  }
  async read(projectId) { const result = await this.repository.readProject({ projectId }); const mediaCatalog = await this.#mediaCatalog(); return { ...result, content: migrateGenericProject(result.project, { mediaCatalog }) }; }
  async update({ projectId, expectedStoreRevision, expectedContentRevision, patch }) {
    const result = await this.repository.readProject({ projectId }); const mediaCatalog = await this.#mediaCatalog(); const current = migrateGenericProject(result.project, { mediaCatalog });
    const next = updateContentProject(current, patch, { expectedRevision: expectedContentRevision, mediaCatalog }); const extensions = { ...result.project.extensions, [CONTENT_PROJECT_EXTENSION_KEY]: next };
    return this.repository.updateProject({ projectId, expectedRevision: expectedStoreRevision, patch: { title: next.brief.title, mediaIds: next.brief.selectedMediaIds, extensions } });
  }
  async archive({ projectId, expectedStoreRevision }) { return this.repository.archiveProject({ projectId, expectedRevision: expectedStoreRevision }); }
  static validate(project, options) { return validateContentProject(project, options); }
}
module.exports = { ContentProjectService };
