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
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && menu?.getAttribute('aria-expanded') === 'true') { closeMenu(); menu.focus(); } });
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
  const sidebarLinks = () => [...(sidebar?.querySelectorAll('a[href]') ?? [])];
  function setSidebar(open) {
    document.body.classList.toggle('sidebar-open', open);
    chapters?.setAttribute('aria-expanded', String(open));
    if (sidebar) sidebar.inert = narrow.matches && !open;
    if (open) sidebarLinks()[0]?.focus({ preventScroll: true });
  }
  chapters?.addEventListener('click', () => setSidebar(!document.body.classList.contains('sidebar-open')));
  document.querySelector('.sidebar-shade')?.addEventListener('click', () => setSidebar(false));
  narrow.addEventListener('change', () => setSidebar(false)); setSidebar(false);
  document.addEventListener('keydown', event => {
    if (!document.body.classList.contains('sidebar-open')) return;
    if (event.key === 'Escape') { setSidebar(false); chapters?.focus(); return; }
    if (event.key !== 'Tab') return;
    const links = sidebarLinks(), first = links[0], last = links.at(-1), current = document.activeElement;
    let target = null;
    if (!sidebar.contains(current)) target = event.shiftKey ? last : first;
    else if (event.shiftKey && current === first) target = last;
    else if (!event.shiftKey && current === last) target = first;
    if (target) { event.preventDefault(); target.focus(); }
  });
  document.querySelectorAll('.heading-permalink').forEach(link => { link.tabIndex = -1; if (ui.permalink) link.title = ui.permalink; });
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
  const status = dialog.querySelector('.search-status');
  const searchButton = document.querySelector('[data-search-open]');
  results.id = 'search-results';
  input.setAttribute('aria-controls', results.id);
  let searchIndex, selected = 0, rendered = [], opener = null;
  const normalize = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\u2018\u2019\u02bc]/g, "'").toLowerCase();
  const sectionLabel = section => document.querySelector('#ui-strings')?.getAttribute('data-section-' + section) || '';
  // Listed by rank: a term found in the title beats one found in a heading, which beats the body text.
  const SEARCH_FIELDS = ['title', 'headings', 'text'];
  const clip = (text, length) => text.length > length ? text.slice(0, length) + '…' : text;
  function originalOffset(text, foldedOffset) {
    let low = 0, high = text.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (normalize(text.slice(0, middle + 1)).length > foldedOffset) high = middle; else low = middle + 1;
    }
    return low;
  }
  function snippet(entry, term) {
    const text = entry.page.text, at = entry.text.indexOf(term);
    const start = originalOffset(text, at), end = originalOffset(text, at + term.length - 1) + 1;
    let from = Math.max(0, start - 40), to = Math.min(text.length, end + 80);
    const spaceAfterFrom = text.indexOf(' ', from), spaceBeforeTo = text.lastIndexOf(' ', to);
    if (from > 0 && spaceAfterFrom !== -1 && spaceAfterFrom < start) from = spaceAfterFrom + 1;
    if (to < text.length && spaceBeforeTo > end) to = spaceBeforeTo;
    return (from > 0 ? '…' : '') + text.slice(from, to) + (to < text.length ? '…' : '');
  }
  function match(entry, terms) {
    const fields = terms.map(term => SEARCH_FIELDS.findIndex(field => entry[field].includes(term)));
    if (fields.includes(-1)) return null;
    const bodyTerm = terms.find((term, position) => SEARCH_FIELDS[fields[position]] === 'text');
    return {
      page: entry.page,
      score: fields.reduce((sum, field) => sum + field, 0),
      hits: terms.reduce((sum, term) => sum + entry.text.split(term).length - 1, 0),
      summary: bodyTerm === undefined ? clip(entry.page.excerpt, 120) : snippet(entry, bodyTerm),
    };
  }
  function select(index) {
    rendered[selected]?.classList.remove('selected'); rendered[selected]?.setAttribute('aria-selected', 'false');
    selected = index;
    rendered[selected].classList.add('selected'); rendered[selected].setAttribute('aria-selected', 'true');
    input.setAttribute('aria-activedescendant', rendered[selected].id);
  }
  const plural = new Intl.PluralRules(document.documentElement.lang);
  const resultCount = count => (plural.select(count) === 'one' ? status.dataset.resultOne : status.dataset.resultOther).replace('{count}', count);
  function renderResults() {
    if (!searchIndex) return;
    const terms = normalize(input.value.trim()).split(/\s+/).filter(Boolean);
    const matches = searchIndex.map(entry => match(entry, terms)).filter(Boolean);
    matches.sort((a, b) => a.score - b.score || b.hits - a.hits);
    results.replaceChildren(); selected = 0;
    matches.forEach(({ page, summary }, index) => {
      const id = 'search-result-' + index;
      const link = document.createElement('a'); link.className = 'search-result'; link.href = localePrefix + page.url + '/';
      link.id = id; link.setAttribute('role', 'option'); link.setAttribute('aria-selected', 'false');
      link.setAttribute('aria-labelledby', id + '-title'); link.setAttribute('aria-describedby', id + '-section ' + id + '-excerpt');
      const section = document.createElement('span'); section.id = id + '-section'; section.textContent = sectionLabel(page.section);
      const title = document.createElement('h3'); title.id = id + '-title'; title.textContent = page.title;
      const excerpt = document.createElement('p'); excerpt.id = id + '-excerpt'; excerpt.textContent = summary;
      link.append(section, title, excerpt); results.append(link);
    });
    rendered = [...results.querySelectorAll('a')];
    // A listbox may only hold options: the loading, error and empty messages live outside that role.
    if (rendered.length) { results.setAttribute('role', 'listbox'); results.setAttribute('aria-label', input.getAttribute('aria-label')); select(0); }
    else { results.removeAttribute('role'); results.removeAttribute('aria-label'); input.removeAttribute('aria-activedescendant'); }
    if (!matches.length) { const empty = document.createElement('p'); empty.className = 'search-empty'; empty.textContent = ui.noResults; results.append(empty); }
    status.textContent = matches.length ? resultCount(matches.length) : ui.noResults;
  }
  async function openSearch(event) {
    if (dialog.open) return;
    opener = event?.currentTarget ?? document.activeElement;
    closeMenu(); setSidebar(false); dialog.showModal(); input.focus();
    if (!searchIndex) {
      results.textContent = status.textContent = ui.loading;
      try {
        const response = await fetch(localePrefix + '/search.json'); if (!response.ok) throw new Error('Index unavailable');
        searchIndex = (await response.json()).map(page => ({ page, title: normalize(page.title), headings: normalize(page.headings.join('\n')), text: normalize(page.text) }));
      }
      catch { results.textContent = status.textContent = ui.searchError; return; }
    }
    renderResults();
  }
  document.querySelectorAll('[data-search-open]').forEach(button => button.addEventListener('click', openSearch));
  dialog.addEventListener('close', () => {
    status.textContent = ''; opener?.focus();
    if (document.activeElement !== opener || opener === document.body) searchButton?.focus();
  });
  const applePlatform = /^(mac|iphone|ipad|ipod|ios)/i.test(navigator.userAgentData?.platform ?? navigator.platform);
  if (!applePlatform) document.querySelectorAll('[data-search-open] kbd').forEach(kbd => { kbd.textContent = 'Ctrl K'; });
  dialog.querySelector('.search-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } });
  input.addEventListener('input', renderResults);
  results.addEventListener('focusin', event => { const index = rendered.indexOf(event.target); if (index !== -1 && index !== selected) select(index); });
  dialog.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); dialog.close(); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!rendered.length) return;
      const focusInList = rendered.includes(document.activeElement);
      select((selected + (event.key === 'ArrowDown' ? 1 : -1) + rendered.length) % rendered.length);
      rendered[selected].scrollIntoView({ block: 'nearest' });
      if (focusInList) rendered[selected].focus();
    }
    if (event.key === 'Enter' && event.target === input && rendered[selected]) { event.preventDefault(); rendered[selected].click(); }
  });
  document.addEventListener('keydown', event => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); if (dialog.open) dialog.close(); else openSearch(); } });
})();
