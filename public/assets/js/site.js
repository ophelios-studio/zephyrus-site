(() => {
  'use strict';
  const ui = document.querySelector('#ui-strings')?.dataset || {};
  const localePrefix = document.body.dataset.localePrefix || '';
  document.querySelectorAll('[data-language-link]').forEach(link => {
    link.href += location.hash;
    window.addEventListener('hashchange', () => { const target = new URL(link.href); target.hash = location.hash; link.href = target.href; });
  });
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  if (!reducedMotion.matches && 'IntersectionObserver' in window) {
    document.documentElement.classList.add('motion-ready');
    const reveal = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) { entry.target.classList.add('is-visible'); reveal.unobserve(entry.target); }
    }), { threshold: .08 });
    document.querySelectorAll('[data-reveal]').forEach(el => reveal.observe(el));
  }

  const mobileNav = document.querySelector('.mobile-nav');
  const menu = document.querySelector('.menu-toggle');
  const closeMenu = () => { if (mobileNav) mobileNav.hidden = true; menu?.setAttribute('aria-expanded', 'false'); menu?.setAttribute('aria-label', ui.openMenu || 'Open navigation'); };
  menu?.addEventListener('click', () => {
    const open = menu.getAttribute('aria-expanded') !== 'true';
    menu.setAttribute('aria-expanded', String(open)); mobileNav.hidden = !open;
    menu.setAttribute('aria-label', open ? ui.closeMenu : ui.openMenu);
  });
  mobileNav?.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(); });
  matchMedia('(min-width: 601px)').addEventListener('change', closeMenu);

  const escapeHTML = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  // One tokenizer keeps strings and comments intact; all source is escaped first.
  function highlight(code) {
    const source = code.textContent;
    const isPHP = code.classList.contains('language-php');
    const isJSON = code.classList.contains('language-json');
    const pattern = isPHP
      ? /\/\/[^\n]*|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|\$[a-zA-Z_]\w*|\b(?:namespace|use|final|class|extends|public|function|return|int|string|new|true|false|null)\b/g
      : isJSON ? /"(?:[^"\\]|\\.)*"|\b(?:true|false|null|\d+)\b/g : /#[^\n]*|\b(?:true|false|application|render|localization|environment|debug|engine|directory|cache|locale|timezone)\b/g;
    let result = '', position = 0;
    for (const match of source.matchAll(pattern)) {
      result += escapeHTML(source.slice(position, match.index));
      const value = match[0];
      const type = value.startsWith('//') || (!isPHP && value.startsWith('#')) ? 'comment' : /^["']/.test(value) ? 'string' : value.startsWith('$') ? 'variable' : 'keyword';
      result += '<span class="token-' + type + '">' + escapeHTML(value) + '</span>';
      position = match.index + value.length;
    }
    code.innerHTML = result + escapeHTML(source.slice(position));
  }
  document.querySelectorAll('code.language-php, code.language-yaml, code.language-json').forEach(highlight);

  async function copyText(text, button) {
    const original = button.innerHTML;
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = ui.copied || 'Copied ✓';
    } catch {
      button.textContent = ui.selectCode || 'Select code';
      const code = button.closest('.code-window, pre, .agent-command, .install-command')?.querySelector('.code-panel:not([hidden]) code, code');
      if (code) { const range = document.createRange(); range.selectNodeContents(code); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); }
    }
    setTimeout(() => { button.innerHTML = original; }, 1800);
  }
  document.querySelectorAll('.prose pre').forEach(pre => {
    const button = document.createElement('button');
    button.className = 'copy-button'; button.textContent = (ui.copy || 'Copy') + ' ⧉'; button.setAttribute('aria-label', ui.copyBlock || 'Copy code block');
    button.addEventListener('click', () => copyText(pre.querySelector('code').textContent, button)); pre.append(button);
  });
  document.querySelector('[data-copy-example]')?.addEventListener('click', event => {
    const blocks = [...document.querySelectorAll('.code-panel:not([hidden]) pre code')];
    copyText(blocks.map(code => code.textContent).join('\n\n'), event.currentTarget);
  });
  document.querySelectorAll('[data-copy-target]').forEach(button => button.addEventListener('click', () => copyText(document.getElementById(button.dataset.copyTarget).textContent, button)));
  document.querySelectorAll('[data-example-locale]').forEach(button => button.addEventListener('click', () => {
    document.querySelector('[data-demo-greeting]').textContent = button.dataset.exampleGreeting;
    document.querySelector('[data-demo-items]').textContent = button.dataset.exampleItems;
    document.querySelectorAll('[data-example-locale]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  }));

  const tabs = [...document.querySelectorAll('[data-code-tab]')];
  function selectTab(tab) {
    tabs.forEach(item => {
      const active = item === tab; item.classList.toggle('active', active);
      item.setAttribute('aria-selected', String(active)); item.tabIndex = active ? 0 : -1;
      document.getElementById(item.getAttribute('aria-controls')).hidden = !active;
    });
    document.querySelector('.file-name').textContent = tab.dataset.file;
    document.querySelector('.language-tag').textContent = tab.dataset.language;
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next !== undefined) { event.preventDefault(); selectTab(tabs[next]); tabs[next].focus(); }
    });
  });
  document.querySelectorAll('.architecture-list details').forEach(detail => {
    detail.addEventListener('toggle', () => { if (detail.open) document.querySelectorAll('.architecture-list details').forEach(other => { if (other !== detail) other.open = false; }); });
  });

  const sidebar = document.querySelector('.docs-sidebar');
  const chapters = document.querySelector('.docs-menu-button');
  const narrow = matchMedia('(max-width: 600px)');
  function setSidebar(open) {
    document.body.classList.toggle('sidebar-open', open);
    chapters?.setAttribute('aria-expanded', String(open));
    if (sidebar) sidebar.inert = narrow.matches && !open;
  }
  chapters?.addEventListener('click', () => setSidebar(!document.body.classList.contains('sidebar-open')));
  document.querySelector('.sidebar-shade')?.addEventListener('click', () => setSidebar(false));
  narrow.addEventListener('change', () => setSidebar(false)); setSidebar(false);
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && document.body.classList.contains('sidebar-open')) { setSidebar(false); chapters?.focus(); } });
  const headings = document.querySelectorAll('.prose h2, .prose h3');
  if ('IntersectionObserver' in window && headings.length) {
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      document.querySelectorAll('.toc-link').forEach(link => link.classList.toggle('active', link.hash === '#' + entry.target.id));
    }), { rootMargin: '-120px 0px -60% 0px', threshold: 0 });
    headings.forEach(heading => observer.observe(heading));
  }

  const dialog = document.querySelector('.search-dialog');
  if (!dialog) return;
  const input = document.querySelector('#doc-search');
  const results = dialog.querySelector('.search-results');
  let searchIndex, selected = 0, rendered = [];
  const normalize = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  function renderResults() {
    if (!searchIndex) return;
    const query = normalize(input.value.trim());
    const terms = query.split(/\s+/).filter(Boolean);
    const matches = searchIndex.filter(page => terms.every(term => normalize(page.title + ' ' + page.excerpt + ' ' + page.headings.join(' ')).includes(term)));
    matches.sort((a, b) => Number(normalize(b.title).includes(query)) - Number(normalize(a.title).includes(query)));
    results.replaceChildren(); selected = 0;
    matches.forEach(page => {
      const link = document.createElement('a'); link.className = 'search-result'; link.href = localePrefix + page.url + '/';
      const section = document.createElement('span'); section.textContent = page.section === 'getting-started' ? ui.startSection : ui.fundamentalsSection;
      const title = document.createElement('h3'); title.textContent = page.title;
      const excerpt = document.createElement('p'); excerpt.textContent = page.excerpt.slice(0, 120) + (page.excerpt.length > 120 ? '…' : '');
      link.append(section, title, excerpt); results.append(link);
    });
    rendered = [...results.querySelectorAll('a')]; rendered[0]?.classList.add('selected');
    if (!matches.length) { const empty = document.createElement('p'); empty.className = 'search-empty'; empty.textContent = ui.noResults; results.append(empty); }
  }
  async function openSearch() {
    if (dialog.open) return;
    closeMenu(); setSidebar(false); dialog.showModal(); input.focus();
    if (!searchIndex) {
      results.textContent = ui.loading;
      try { const response = await fetch(localePrefix + '/search.json'); if (!response.ok) throw new Error('Index unavailable'); searchIndex = await response.json(); }
      catch { results.textContent = ui.searchError; return; }
    }
    renderResults();
  }
  document.querySelectorAll('[data-search-open]').forEach(button => button.addEventListener('click', openSearch));
  dialog.querySelector('.search-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } });
  input.addEventListener('input', renderResults);
  dialog.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); dialog.close(); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!rendered.length) return;
      rendered[selected]?.classList.remove('selected');
      selected = (selected + (event.key === 'ArrowDown' ? 1 : -1) + rendered.length) % rendered.length;
      rendered[selected].classList.add('selected'); rendered[selected].scrollIntoView({ block: 'nearest' });
    }
    if (event.key === 'Enter' && event.target === input && rendered[selected]) { event.preventDefault(); rendered[selected].click(); }
  });
  document.addEventListener('keydown', event => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); if (dialog.open) dialog.close(); else openSearch(); } });
})();
