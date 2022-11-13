import * as log from './log';
import type { ParseTreeElem, ParseTreeTableAlign, ParseTreeFootNoteDef } from './ipc';

export class PreviewContent {
    rootElem: HTMLElement;

    constructor() {
        const root = document.getElementById('preview-root');
        if (!root) {
            throw new Error('The root element to mount Markdown preview is not found in DOM');
        }
        this.rootElem = root;
    }

    render(tree: ParseTreeElem[]): void {
        this.rootElem.textContent = '';
        const renderer = new ParseTreeRenderer();
        for (const elem of tree) {
            renderer.render(elem, this.rootElem);
        }
        renderer.end(this.rootElem);
    }
}

interface TableState {
    aligns: ParseTreeTableAlign[];
    index: number;
}

class ParseTreeRenderer {
    table: TableState | null;
    footNotes: ParseTreeFootNoteDef[];

    constructor() {
        this.table = null;
        this.footNotes = [];
    }

    tableAlign(): ParseTreeTableAlign {
        if (this.table === null) {
            return null;
        }
        const { aligns, index } = this.table;
        if (aligns.length >= index) {
            return null;
        }
        return aligns[index];
    }

    render(elem: ParseTreeElem, parent: HTMLElement): void {
        if (typeof elem === 'string') {
            parent.append(elem);
            return;
        }

        let node: HTMLElement;
        switch (elem.t) {
            case 'p':
                node = document.createElement('p');
                break;
            case 'h': {
                const h = document.createElement(`h${elem.level}`) as HTMLHeadingElement;
                if (elem.id) {
                    // TODO?: Clobber IDs
                    h.id = elem.id;
                }
                node = h;
                break;
            }
            case 'a': {
                const a = document.createElement('a');
                a.href = elem.href;
                if (elem.title) {
                    a.title = elem.title;
                }
                node = a;
                break;
            }
            case 'img': {
                const i = document.createElement('img');
                i.src = elem.src;
                if (elem.title) {
                    i.title = elem.title;
                }
                const tmp = document.createElement('span');
                for (const child of elem.c) {
                    this.render(child, tmp);
                }
                i.alt = tmp.innerHTML;
                parent.appendChild(i);
                return;
            }
            case 'br':
                node = document.createElement('br');
                break;
            case 'blockquote':
                node = document.createElement('blockquote');
                break;
            case 'em':
                node = document.createElement('em');
                break;
            case 'strong':
                node = document.createElement('strong');
                break;
            case 'del':
                node = document.createElement('del');
                break;
            case 'pre':
                node = document.createElement('pre');
                break;
            case 'code': {
                const c = document.createElement('code');
                if (elem.lang) {
                    // TODO: Get correct langauge from `elem.lang` via highlight.js
                    c.className = `language-${elem.lang}`;
                }
                node = c;
                break;
            }
            case 'ol': {
                const o = document.createElement('ol');
                if (typeof elem.start === 'number') {
                    o.start = elem.start;
                }
                node = o;
                break;
            }
            case 'ul':
                node = document.createElement('ul');
                break;
            case 'li':
                node = document.createElement('li');
                break;
            case 'table': {
                this.table = {
                    aligns: elem.align,
                    index: 0,
                };
                node = document.createElement('table');
                break;
            }
            case 'thead':
                node = document.createElement('thead');
                break;
            case 'tbody':
                node = document.createElement('thead');
                break;
            case 'tr':
                if (this.table) {
                    this.table.index = 0;
                }
                node = document.createElement('tr');
                break;
            case 'th':
                if (this.table) {
                    this.table.index++;
                }
                node = document.createElement('th');
                break;
            case 'td':
                if (this.table) {
                    this.table.index++;
                }
                node = document.createElement('td');
                break;
            case 'checkbox': {
                const i = document.createElement('input');
                i.disabled = true;
                i.checked = elem.checked;
                node = i;
                break;
            }
            case 'hr':
                node = document.createElement('hr');
                break;
            case 'fn-ref': {
                const a = document.createElement('a');
                a.href = `#user-content-fn-${elem.id}`;
                a.id = `user-content-fnref-${elem.id}`;
                a.setAttribute('aria-describedby', 'footnote-label');
                const sup = document.createElement('sup');
                sup.appendChild(a);
                node = sup;
                break;
            }
            case 'fn-def':
                this.footNotes.push(elem);
                return;
            case 'html': {
                const tmp = document.createElement('span');
                tmp.innerHTML = elem.raw;
                for (;;) {
                    const c = tmp.lastChild;
                    if (c === null) {
                        return;
                    }
                    tmp.removeChild(c);
                    parent.appendChild(c);
                }
            }
            default:
                log.error('Unknown parse tree element:', JSON.stringify(elem));
                return;
        }

        if ('c' in elem) {
            for (const child of elem.c) {
                this.render(child, node);
            }
        }

        parent.appendChild(node);
    }

    end(parent: HTMLElement): void {
        if (this.footNotes.length === 0) {
            return;
        }
        const section = document.createElement('section');
        section.className = 'footnotes';

        {
            const heading = document.createElement('h2');
            heading.id = 'footnote-label';
            heading.className = 'sr-only';
            heading.textContent = 'Footnotes';
            section.appendChild(heading);
        }

        {
            const ol = document.createElement('ol');
            for (const elem of this.footNotes) {
                const li = document.createElement('li');
                li.id = `user-content-fn-${elem.id}`;

                for (const child of elem.c) {
                    this.render(child, li);
                }

                const a = document.createElement('a');
                a.textContent = '↩';
                a.href = `user-content-fnref-${elem.id}`;
                a.className = 'data-footnote-backref';
                a.setAttribute('aria-label', 'Back to content');

                (li.lastChild ?? li).appendChild(a);
                ol.appendChild(li);
            }
            section.appendChild(ol);
        }

        parent.appendChild(section);
    }
}
