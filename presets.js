// Named scenarios: snapshots of the working state, kept apart so the calculator stays a playground.
// Stored under their own key; JSON export/import of a single scenario.
(function (root) {
  'use strict';
  const $ = (sel) => document.querySelector(sel);
  const KEY = 'lissage-mensualites/presets';
  const FORMAT = 'lissage-mensualites/scenario';

  function init({ getState, setState, persist }) {
    let presets = readAll(persist);
    const select = $('#preset-select');
    const dialog = $('#preset-dialog');
    const nameInput = $('#preset-name');
    const write = () => { if (persist) try { localStorage.setItem(KEY, JSON.stringify(presets)); } catch (_) { /* ignore */ } };
    const current = () => presets.find((p) => p.name === select.value);

    function refresh(selected = select.value) {
      select.innerHTML = '<option value="">Scénarios…</option>'
        + presets.map((p) => `<option value="${escape(p.name)}">${escape(p.name)}</option>`).join('');
      select.value = presets.some((p) => p.name === selected) ? selected : '';
      sync();
    }
    // Marks the save button when the working state differs from the selected scenario.
    function sync() {
      const p = current();
      $('#preset-save').classList.toggle('dirty', !!p && JSON.stringify(p.state) !== JSON.stringify(getState()));
      $('#preset-delete').disabled = !p;
    }
    function save(name, state) {
      const existing = presets.find((p) => p.name === name);
      if (existing) existing.state = state;
      else presets.push({ name, state });
      write();
      refresh(name);
    }

    select.addEventListener('change', () => { const p = current(); if (p) setState(structuredClone(p.state)); sync(); });
    $('#preset-save').addEventListener('click', () => { nameInput.value = select.value; dialog.showModal(); nameInput.select(); });
    $('#preset-cancel').addEventListener('click', () => dialog.close());
    dialog.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = nameInput.value.trim();
      if (!name) return;
      save(name, getState());
      dialog.close();
    });
    $('#preset-delete').addEventListener('click', () => {
      const p = current();
      if (!p || !window.confirm(`Supprimer le scénario « ${p.name} » ?`)) return;
      presets = presets.filter((x) => x !== p);
      write();
      refresh('');
    });
    $('#preset-export').addEventListener('click', () => download(select.value || 'scenario', { format: FORMAT, name: select.value || 'Scénario', ...getState() }));
    $('#preset-import').addEventListener('click', () => $('#preset-file').click());
    $('#preset-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      const data = await parse(file);
      if (!data) { window.alert('Fichier invalide : il doit contenir des crédits et un objectif.'); return; }
      const { name = file.name.replace(/\.json$/i, ''), loans, nextId, line } = data;
      setState({ loans, nextId, line });
      save(name, getState());
    });

    refresh('');
    root.Presets.sync = sync;
  }

  function readAll(persist) {
    if (!persist) return [];
    try { return JSON.parse(localStorage.getItem(KEY)) ?? []; } catch (_) { return []; }
  }
  async function parse(file) {
    try {
      const data = JSON.parse(await file.text());
      return Array.isArray(data?.loans) && data?.line ? data : null;
    } catch (_) { return null; }
  }
  function download(name, data) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = `lissage-${name.replace(/[^\w-]+/g, '_')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const escape = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  root.Presets = { init, sync: () => {} };
})(window);
