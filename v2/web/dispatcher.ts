import Mousetrap from 'mousetrap';
import {
    type Dispatch,
    type State,
    INITIAL_STATE,
    openSearch,
    searchNext,
    searchPrevious,
    setSearchMatcher,
    setPreviewing,
    openOutline,
    setTheme,
} from './reducer';
import { sendMessage, type MessageFromMain, type KeyAction } from './ipc';
import { PreviewContent } from './markdown';
import * as log from './log';

// Global action dispatcher to handle IPC messages from the main and key shortcuts

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

export class GlobalDispatcher {
    public dispatch: Dispatch;
    public state: State;
    public content: PreviewContent;

    constructor(window: Window, previewRoot: HTMLElement) {
        this.dispatch = () => {
            // do nothing by default
        };
        this.state = INITIAL_STATE;
        this.content = new PreviewContent(window, previewRoot);
    }

    setDispatch(dispatch: Dispatch, state: State): void {
        this.dispatch = dispatch;
        this.state = state;
    }

    openSearch(): void {
        this.dispatch(openSearch());
    }

    searchNext(): void {
        const { searching, searchIndex } = this.state;
        if (searching) {
            this.dispatch(searchNext(searchIndex));
        }
    }

    searchPrev(): void {
        const { searching, searchIndex } = this.state;
        if (searching) {
            this.dispatch(searchPrevious(searchIndex));
        }
    }

    // Note: Passing message as JSON string and parse it with JSON.parse may be faster.
    // https://v8.dev/blog/cost-of-javascript-2019#json
    handleIpcMessage(msg: MessageFromMain): void {
        log.debug('Received IPC message from main:', msg.kind, msg);
        // This method must not throw exception since the main process call this method like `window.ShibaApp.receive(msg)`.
        try {
            switch (msg.kind) {
                case 'render_tree':
                    this.content.render(msg.tree);
                    this.dispatch(setPreviewing(true));
                    break;
                case 'config':
                    for (const keybind of Object.keys(msg.keymaps)) {
                        const action = msg.keymaps[keybind];
                        Mousetrap.bind(keybind, e => {
                            e.preventDefault();
                            e.stopPropagation();
                            log.debug('Triggered key shortcut:', action, keybind);
                            try {
                                this.handleKeyAction(action);
                            } catch (err) {
                                log.error('Error while handling key action', action, err);
                            }
                        });
                    }
                    this.content.setTheme(msg.theme);
                    this.dispatch(setTheme(msg.theme));
                    this.dispatch(setSearchMatcher(msg.search.matcher));
                    break;
                case 'search':
                    this.openSearch();
                    break;
                case 'search_next':
                    this.searchNext();
                    break;
                case 'search_previous':
                    this.searchPrev();
                    break;
                case 'outline':
                    this.dispatch(openOutline());
                    break;
                case 'welcome':
                    this.dispatch(setPreviewing(false));
                    break;
                case 'debug':
                    log.enableDebug();
                    log.debug('Debug log is enabled');
                    break;
                default:
                    log.error('Unknown message:', msg);
                    break;
            }
        } catch (err) {
            log.error('Error while handling received IPC message', err, msg);
        }
    }

    handleKeyAction(action: KeyAction): void {
        switch (action) {
            case 'ScrollDown':
                window.scrollBy(0, window.innerHeight / 2);
                break;
            case 'ScrollUp':
                window.scrollBy(0, -window.innerHeight / 2);
                break;
            case 'ScrollLeft':
                window.scrollBy(-window.innerWidth / 2, 0);
                break;
            case 'ScrollRight':
                window.scrollBy(window.innerWidth / 2, 0);
                break;
            case 'ScrollPageDown':
                window.scrollBy(0, window.innerHeight);
                break;
            case 'ScrollPageUp':
                window.scrollBy(0, -window.innerHeight);
                break;
            case 'Forward':
                sendMessage({ kind: 'forward' });
                break;
            case 'Back':
                sendMessage({ kind: 'back' });
                break;
            case 'Reload':
                sendMessage({ kind: 'reload' });
                break;
            case 'OpenFile':
                sendMessage({ kind: 'file_dialog' });
                break;
            case 'OpenDir':
                sendMessage({ kind: 'dir_dialog' });
                break;
            case 'ScrollTop':
                window.scrollTo(0, 0);
                break;
            case 'ScrollBottom':
                window.scrollTo(0, document.body.scrollHeight);
                break;
            case 'Search':
                this.openSearch();
                break;
            case 'SearchNext':
                this.searchNext();
                break;
            case 'SearchPrev':
                this.searchPrev();
                break;
            case 'NextSection': {
                const headings: NodeListOf<HTMLElement> = document.querySelectorAll('h1,h2,h3,h4,h5,h6');
                scrollTo(headings, (elem, windowTop) => elem.offsetTop > windowTop);
                break;
            }
            case 'PrevSection': {
                const headings: HTMLElement[] = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'));
                headings.reverse();
                scrollTo(headings, (elem, windowTop) => elem.offsetTop < windowTop);
                break;
            }
            case 'Outline':
                this.dispatch(openOutline());
                break;
            case 'Quit':
                sendMessage({ kind: 'quit' });
                break;
            default:
                log.error('Unknown key action:', action);
                break;
        }
    }
}
