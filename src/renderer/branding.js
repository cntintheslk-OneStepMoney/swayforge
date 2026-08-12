'use strict';

(function initialiseBranding() {
  if (!globalThis.document) return;

  const MARK_PATH = './brand/sway-forge-mark.svg';
  const DISPLAY_NAME = 'Sway Forge';
  const MOTTO = 'Create smarter. Stay in control.';

  function node(tag, options = {}, children = []) {
    const element = document.createElement(tag);
    if (options.className) element.className = options.className;
    if (options.text !== undefined) element.textContent = options.text;
    if (options.src) element.src = options.src;
    if (options.alt !== undefined) element.alt = options.alt;
    if (options.ariaHidden) element.setAttribute('aria-hidden', 'true');
    for (const child of children) if (child) element.append(child);
    return element;
  }

  function applyAboutBranding() {
    const facts = document.querySelector('#settings-about-facts');
    const article = facts?.closest('article');
    if (!article || article.dataset.brandingApplied === 'true') return Boolean(article);

    const currentHeading = article.querySelector('h3');
    const currentHelp = currentHeading?.nextElementSibling;
    const mark = node('img', {
      className: 'settings-brand-lockup__mark',
      src: MARK_PATH,
      alt: '',
      ariaHidden: true
    });
    const copy = node('div', { className: 'settings-brand-lockup__copy' }, [
      node('h3', { className: 'settings-brand-lockup__name', text: DISPLAY_NAME }),
      node('p', { className: 'settings-brand-lockup__motto', text: MOTTO }),
      node('div', { className: 'settings-brand-lockup__accent', ariaHidden: true })
    ]);
    const lockup = node('div', { className: 'settings-brand-lockup' }, [mark, copy]);

    if (currentHeading) currentHeading.replaceWith(lockup);
    else article.prepend(lockup);
    if (currentHelp?.classList.contains('settings-help')) currentHelp.remove();
    article.dataset.brandingApplied = 'true';
    return true;
  }

  function boot() {
    if (applyAboutBranding()) return;
    const settingsView = document.querySelector('#view-settings');
    if (!settingsView) return;
    const observer = new MutationObserver(() => {
      if (applyAboutBranding()) observer.disconnect();
    });
    observer.observe(settingsView, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
