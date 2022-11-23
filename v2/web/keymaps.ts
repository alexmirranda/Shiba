import Mousetrap from 'mousetrap';
import { openOutline, openHistory } from './reducer';
import type { GlobalDispatcher } from './dispatcher';
import { sendMessage, type KeyMaps, type KeyAction } from './ipc';
import * as log from './log';

function scrollTo(
    candidates: HTMLElement[] | NodeListOf<HTMLElement>,
    pred: (e: HTMLElement, t: number) => boolean,
): void {
    if (candidates.length === 0) {
        return;
    }
    let scrolled = false;
    const windowTop = window.scrollY;
    for (const elem of candidates) {
        if (pred(elem, windowTop)) {
            window.scrollTo(0, elem.offsetTop);
            if (windowTop !== window.scrollY) {
                scrolled = true;
                break;
            }
        }
    }
    if (!scrolled) {
        window.scrollTo(0, candidates[0].offsetTop);
    }
}

export interface KeyShortcut {
    dispatch(dispatcher: GlobalDispatcher): void;
    description: string;
}

const KeyShortcuts: { [K in KeyAction]: KeyShortcut } = {
    ScrollDown: {
        description: 'Scroll down the page by half of window height',
        dispatch(): void {
            window.scrollBy(0, window.innerHeight / 2);
        },
    },

    ScrollUp: {
        description: 'Scroll up the page by half of window height',
        dispatch(): void {
            window.scrollBy(0, -window.innerHeight / 2);
        },
    },

    ScrollLeft: {
        description: 'Scroll the page to the left by half of window width',
        dispatch(): void {
            window.scrollBy(-window.innerWidth / 2, 0);
        },
    },

    ScrollRight: {
        description: 'Scroll the page to the right by half of window width',
        dispatch(): void {
            window.scrollBy(window.innerWidth / 2, 0);
        },
    },

    ScrollPageDown: {
        description: 'Scroll down the page by window height',
        dispatch(): void {
            window.scrollBy(0, window.innerHeight);
        },
    },

    ScrollPageUp: {
        description: 'Scroll up the page by window height',
        dispatch(): void {
            window.scrollBy(0, -window.innerHeight);
        },
    },

    ScrollTop: {
        description: 'Scroll to the top of the page',
        dispatch(): void {
            window.scrollTo(0, 0);
        },
    },

    ScrollBottom: {
        description: 'Scroll to the bottom of the page',
        dispatch(): void {
            window.scrollTo(0, document.body.scrollHeight);
        },
    },

    ScrollNextSection: {
        description: 'Scroll to the next section header',
        dispatch(): void {
            const headings: NodeListOf<HTMLElement> = document.querySelectorAll('h1,h2,h3,h4,h5,h6');
            scrollTo(headings, (elem, windowTop) => elem.offsetTop > windowTop);
        },
    },

    ScrollPrevSection: {
        description: 'Scroll to the previous section header',
        dispatch(): void {
            const headings: HTMLElement[] = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'));
            headings.reverse();
            scrollTo(headings, (elem, windowTop) => elem.offsetTop < windowTop);
        },
    },

    Forward: {
        description: 'Go forawrd the next document in preview history',
        dispatch(): void {
            sendMessage({ kind: 'forward' });
        },
    },

    Back: {
        description: 'Go ackward the previous document in preview history',
        dispatch(): void {
            sendMessage({ kind: 'back' });
        },
    },

    Reload: {
        description: 'Reload the current document preview',
        dispatch(): void {
            sendMessage({ kind: 'reload' });
        },
    },

    OpenFile: {
        description: 'Open dialog to choose a file to preview',
        dispatch(): void {
            sendMessage({ kind: 'file_dialog' });
        },
    },

    OpenDir: {
        description: 'Open dialog to choose a directory to watch file changes',
        dispatch(): void {
            sendMessage({ kind: 'dir_dialog' });
        },
    },

    Search: {
        description: 'Open in-page search box',
        dispatch(dispatcher: GlobalDispatcher): void {
            dispatcher.openSearch();
        },
    },

    SearchNext: {
        description: 'Focus next match of ongoing text search',
        dispatch(dispatcher: GlobalDispatcher): void {
            dispatcher.searchNext();
        },
    },

    SearchPrev: {
        description: 'Focus previous match of ongoing text search',
        dispatch(dispatcher: GlobalDispatcher): void {
            dispatcher.searchPrev();
        },
    },

    Outline: {
        description: 'Open palette to incrementally search section headers',
        dispatch(dispatcher: GlobalDispatcher): void {
            dispatcher.dispatch(openOutline());
        },
    },

    History: {
        description: 'Open palette to incrementally search files in history',
        dispatch(dispatcher: GlobalDispatcher): void {
            dispatcher.dispatch(openHistory());
        },
    },

    Quit: {
        description: 'Quit application',
        dispatch(): void {
            sendMessage({ kind: 'quit' });
        },
    },
};

export interface BoundShortcut {
    action: KeyAction;
    binds: string[];
    shortcut: KeyShortcut;
}

export class KeyMapping {
    private sortedShortcuts: BoundShortcut[] = [];

    get shortcuts(): BoundShortcut[] {
        return this.sortedShortcuts;
    }

    register(maps: KeyMaps, dispatcher: GlobalDispatcher): void {
        const bounds = new Map<KeyAction, BoundShortcut>();

        for (const keybind of Object.keys(maps)) {
            const action: KeyAction = maps[keybind];
            if (!(action in KeyShortcuts)) {
                log.error('Unknown key action in keymaps:', keybind, action);
                continue;
            }

            const shortcut = KeyShortcuts[action];
            const method = shortcut.dispatch.bind(undefined, dispatcher);
            Mousetrap.bind(keybind, e => {
                e.preventDefault();
                e.stopPropagation();
                log.debug('Triggered key shortcut:', action, keybind);
                try {
                    method();
                } catch (err) {
                    log.error('Error while handling key action', action, err);
                }
            });

            const b = bounds.get(action);
            if (b === undefined) {
                bounds.set(action, {
                    action,
                    binds: [keybind],
                    shortcut,
                });
            } else {
                b.binds.push(keybind);
            }
        }

        const shortcuts = [...bounds.values()];
        shortcuts.sort((l, r) => l.action.localeCompare(r.action));
        this.sortedShortcuts = shortcuts;
    }
}
