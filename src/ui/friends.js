import { createLeftDialog } from './leftDialog.js';

/**
 * Dialogo de Amigos: todo mundo que esta logado (a allowlist E o convite), com
 * foto, nome, "lendo agora: titulo" e "N lidos em {ano}". Tocar numa pessoa
 * abre a estante dela em modo leitura. Casca em `leftDialog.js`.
 *
 * Nome e titulo sao texto de OUTRA pessoa — `textContent`, sem excecao.
 */
export function createFriendsDialog(root, { me, list, onOpen, onView }) {
  const $ = (id) => root.querySelector(`#${id}`);
  const ul = $('friends-list');
  const msg = $('friends-msg');

  const dialog = createLeftDialog(root, {
    onOpen,
    onOpened: refresh,
    closeButton: $('friends-close'),
    // A lista chega depois; ate la o foco vai ao "fechar", para o Tab nao
    // cair atras do dialogo.
    initialFocus: $('friends-close'),
  });

  function showError(text) {
    msg.textContent = text ?? '';
    msg.hidden = !text;
  }

  function avatar(person) {
    const pic = document.createElement('span');
    pic.className = 'people__pic';
    if (person.picture) {
      const img = document.createElement('img');
      img.alt = '';
      // Sem isto o googleusercontent devolve 403/429 para alguns referers — e
      // o avatar "some" sem erro nenhum.
      img.referrerPolicy = 'no-referrer';
      img.decoding = 'async';
      img.src = person.picture;
      img.addEventListener('error', () => img.remove());
      pic.append(img);
    } else {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'icon');
      svg.setAttribute('aria-hidden', 'true');
      const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      use.setAttribute('href', '#i-user');
      svg.append(use);
      pic.append(svg);
    }
    return pic;
  }

  function render({ year, items }) {
    ul.replaceChildren();
    const others = items.filter((p) => p.handle !== me.handle);

    if (!others.length) {
      const p = document.createElement('p');
      p.className = 'people__empty';
      p.textContent = 'Ninguém mais por aqui ainda.';
      ul.append(p);
      return;
    }

    for (const person of others) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'people__item';

      const who = document.createElement('span');
      who.className = 'people__who';
      const name = document.createElement('span');
      name.className = 'people__name';
      name.textContent = person.nickname || person.name || person.handle;
      const meta = document.createElement('span');
      meta.className = 'people__meta';
      const lidos = `${person.readThisYear} ${person.readThisYear === 1 ? 'lido' : 'lidos'} em ${year}`;
      meta.textContent = person.reading ? `lendo agora: ${person.reading.title} · ${lidos}` : lidos;
      who.append(name, meta);

      btn.append(avatar(person), who);
      btn.setAttribute('aria-label', `Abrir a estante de ${name.textContent}`);
      btn.addEventListener('click', () => {
        dialog.close({ returnFocus: false });
        onView(person);
      });

      li.append(btn);
      ul.append(li);
    }
  }

  async function refresh() {
    showError(null);
    try {
      render(await list());
    } catch (err) {
      showError(err.message);
    }
  }

  return {
    open: dialog.open,
    close: dialog.close,
    get isOpen() {
      return dialog.isOpen;
    },
  };
}
