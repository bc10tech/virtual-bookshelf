import { createLeftDialog } from './leftDialog.js';
import { splashTitle } from './splashTitle.js';

/**
 * Dialogo de Perfil — e o que faz a splash valer: ate aqui `nickname` e
 * `gender` existiam no documento e ninguem conseguia preenche-los. Casca em
 * `leftDialog.js`; aqui so o conteudo: apelido com PREVIA AO VIVO do titulo da
 * abertura (o mesmo `splashTitle` da splash), genero (so a preposicao) e
 * handle (a URL da estante).
 *
 * `user` e o objeto do boot e e MUTADO no salvar (`Object.assign`): o menu da
 * conta e o `__shelf.me()` leem dele por referencia, e a proxima abertura ja
 * sai personalizada sem reload. Erros do servidor (409 de handle, 400 de
 * validacao) sao texto de formulario e vao por `textContent`.
 */
export function createProfileDialog(root, { user, save, onOpen, onSaved }) {
  const $ = (id) => root.querySelector(`#${id}`);
  const form = $('profile-form');
  const nickname = $('profile-nickname');
  const handle = $('profile-handle');
  const url = $('profile-url');
  const preview = $('profile-preview');
  const msg = $('profile-msg');
  const saveBtn = $('profile-save');
  const genders = [...form.querySelectorAll('input[name="gender"]')];

  const dialog = createLeftDialog(root, {
    onOpen,
    closeButton: $('profile-close'),
    initialFocus: nickname,
  });

  const gender = () => genders.find((r) => r.checked)?.value || null;

  function showError(text) {
    msg.textContent = text ?? '';
    msg.hidden = !text;
  }

  // Exatamente o que a splash monta (`splash.js`): os segmentos de
  // `splashTitle`, com o sufixo na cor de acento.
  function renderPreview() {
    preview.replaceChildren();
    for (const part of splashTitle({ nickname: nickname.value, gender: gender() })) {
      const span = document.createElement('span');
      if (part.accent) span.className = 'splash__accent';
      span.textContent = part.text;
      preview.append(span);
    }
  }

  function renderUrl() {
    url.textContent = `?u=${handle.value.trim().toLowerCase() || '…'}`;
  }

  function fill({ suggest = '' } = {}) {
    // O apelido salvo manda; a sugestao (primeiro nome do Google, no primeiro
    // login) so entra quando ainda nao ha nenhum.
    nickname.value = user.nickname ?? suggest;
    for (const r of genders) r.checked = r.value === (user.gender ?? '');
    handle.value = user.handle ?? '';
    showError(null);
    renderPreview();
    renderUrl();
  }

  nickname.addEventListener('input', renderPreview);
  for (const r of genders) r.addEventListener('change', renderPreview);
  handle.addEventListener('input', renderUrl);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    saveBtn.disabled = true;
    showError(null);
    try {
      // Os tres vao sempre: o servidor normaliza (apelido vazio -> null,
      // handle em minusculas) e devolve o usuario inteiro.
      const updated = await save({
        nickname: nickname.value,
        gender: gender(),
        handle: handle.value,
      });
      Object.assign(user, updated);
      onSaved?.(updated);
      dialog.close();
    } catch (err) {
      showError(err.message);
      // O campo mais provavel de ter dado errado e o handle (409); o apelido
      // e o genero nao tem como reprovar a partir do formulario.
      if (err.status === 409) handle.focus();
    } finally {
      saveBtn.disabled = false;
    }
  });

  return {
    /** @param {{ suggest?: string }} [opts]  `suggest`: apelido sugerido (primeiro login) */
    open(opts) {
      fill(opts);
      dialog.open();
    },
    close: dialog.close,
    get isOpen() {
      return dialog.isOpen;
    },
  };
}
