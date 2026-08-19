import { createLeftDialog } from './leftDialog.js';

/**
 * Dialogo de convites — a allowlist administravel pelo app. Casca em
 * `leftDialog.js` (a mesma de Perfil e Amigos); aqui so o conteudo: um campo
 * de e-mail e a lista de quem ja foi convidado, com "revogar".
 *
 * Todo texto que vem da API vai por `textContent`.
 */
export function createInvitesDialog(root, { list, invite, revoke, onOpen }) {
  const $ = (id) => root.querySelector(`#${id}`);
  const form = $('invite-form');
  const email = $('invite-email');
  const send = $('invite-send');
  const msg = $('invite-msg');
  const ul = $('invite-list');

  const dialog = createLeftDialog(root, {
    onOpen,
    onOpened: refresh,
    closeButton: $('invites-close'),
    initialFocus: email,
  });

  function showError(text) {
    msg.textContent = text ?? '';
    msg.hidden = !text;
  }

  const fmtDate = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR');
  };

  function render(items) {
    ul.replaceChildren();

    if (!items.length) {
      const p = document.createElement('p');
      p.className = 'invites__empty';
      p.textContent = 'Ninguém convidado ainda.';
      ul.append(p);
      return;
    }

    for (const it of items) {
      const li = document.createElement('li');
      li.className = 'invites__item';

      const who = document.createElement('div');
      who.className = 'invites__who';
      const addr = document.createElement('span');
      addr.className = 'invites__email';
      addr.textContent = it.email;
      const meta = document.createElement('span');
      meta.className = it.accepted ? 'invites__meta invites__meta--in' : 'invites__meta';
      meta.textContent = it.accepted
        ? 'já entrou'
        : `convidado em ${fmtDate(it.createdAt)}`;
      who.append(addr, meta);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'invites__revoke';
      btn.textContent = 'Revogar';
      btn.setAttribute('aria-label', `Revogar convite de ${it.email}`);
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await revoke(it.email);
          await refresh();
        } catch (err) {
          showError(err.message);
          btn.disabled = false;
        }
      });

      li.append(who, btn);
      ul.append(li);
    }
  }

  async function refresh() {
    try {
      render(await list());
    } catch (err) {
      showError(err.message);
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const value = email.value.trim();
    if (!value) {
      email.focus();
      return;
    }
    send.disabled = true;
    showError(null);
    try {
      await invite(value);
      // `reset()` e nao `value = ''`: limpa tambem o estado "ja mexeu" do
      // campo, senao o `required` vazio ficaria vermelho (`:user-invalid`).
      form.reset();
      await refresh();
      email.focus();
    } catch (err) {
      showError(err.message);
    } finally {
      send.disabled = false;
    }
  });

  return dialog;
}
