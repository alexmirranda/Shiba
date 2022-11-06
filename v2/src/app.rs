use crate::cli::Options;
use crate::config::Config;
use crate::dialog::Dialog;
use crate::opener::Opener;
use crate::renderer::{
    MenuItem, MenuItems, MessageFromRenderer, MessageToRenderer, Renderer, UserEvent,
};
use crate::watcher::{PathFilter, WatchChannelCreator, Watcher};
use anyhow::Result;
use std::collections::VecDeque;
use std::env;
use std::fs;
use std::marker::PhantomData;
use std::mem;
use std::path::{Path, PathBuf, MAIN_SEPARATOR};

#[cfg(debug_assertions)]
const HTML: &str = include_str!("bundle.html");
#[cfg(not(debug_assertions))]
const HTML: &str = include_str!("bundle.min.html");

struct History {
    max_items: usize,
    index: usize,
    items: VecDeque<PathBuf>,
}

impl History {
    const DEFAULT_MAX_HISTORY_SIZE: usize = 20;

    fn new(max_items: usize) -> Self {
        Self { max_items, index: 0, items: VecDeque::new() }
    }

    fn push(&mut self, item: PathBuf) {
        if self.max_items == 0 {
            return;
        }

        if let Some(current) = self.current() {
            if current == &item {
                return; // Do not push the same path repeatedly
            }
        } else {
            self.items.push_back(item);
            log::debug!("Push first history item: {:?}", self.items);
            return;
        }

        if self.items.len() == self.max_items {
            self.items.pop_front();
            self.index = self.index.saturating_sub(1);
        }

        if self.index + 1 < self.items.len() {
            self.items.truncate(self.index + 1);
        }

        self.index += 1;
        self.items.push_back(item);
        log::debug!("Push new history item at {}: {:?}", self.index, self.items);
    }

    fn forward(&mut self) {
        if self.index + 1 < self.items.len() {
            self.index += 1;
        }
    }

    fn back(&mut self) {
        if let Some(i) = self.index.checked_sub(1) {
            self.index = i;
        }
    }

    fn next(&self) -> Option<&PathBuf> {
        self.items.get(self.index + 1)
    }

    fn prev(&self) -> Option<&PathBuf> {
        self.items.get(self.index.checked_sub(1)?)
    }

    fn current(&self) -> Option<&PathBuf> {
        self.items.get(self.index)
    }

    fn is_current(&self, path: &Path) -> bool {
        if let Some(current) = self.current() {
            current.as_path() == path
        } else {
            false
        }
    }
}

#[derive(Debug)]
pub enum AppControl {
    Continue,
    Exit,
}

pub struct App<R: Renderer, O: Opener, W: Watcher, D: Dialog> {
    options: Options,
    renderer: R,
    menu: R::Menu,
    opener: O,
    history: History,
    watcher: W,
    home_dir: Option<PathBuf>,
    config: Config,
    _dialog: PhantomData<D>,
}

impl<R, O, W, D> App<R, O, W, D>
where
    R: Renderer,
    O: Opener,
    W: Watcher,
    D: Dialog,
    R::EventLoop: WatchChannelCreator,
{
    pub fn new(options: Options, event_loop: &R::EventLoop) -> Result<Self> {
        let config = Config::load()?;
        log::debug!("Application config: {:?}", config);

        let renderer = R::open(&options, event_loop, HTML)?;
        let menu = renderer.set_menu();

        let filter = PathFilter::new(&config);
        let mut watcher = W::new(event_loop, filter)?;
        for path in &options.watch_dirs {
            log::debug!("Watching initial directory: {:?}", path);
            watcher.watch(path)?;
        }

        Ok(Self {
            options,
            renderer,
            menu,
            opener: O::default(),
            history: History::new(History::DEFAULT_MAX_HISTORY_SIZE),
            watcher,
            home_dir: dirs::home_dir(),
            config,
            _dialog: PhantomData,
        })
    }

    fn title(&self, path: &Path) -> String {
        if let Some(home_dir) = &self.home_dir {
            if let Ok(path) = path.strip_prefix(home_dir) {
                return format!("Shiba: ~{}{}", MAIN_SEPARATOR, path.display());
            }
        }
        format!("Shiba: {}", path.display())
    }

    fn preview(&self, path: &Path) -> Result<bool> {
        log::debug!("Opening markdown preview for {:?}", path);
        let content = match fs::read_to_string(path) {
            Ok(content) => content,
            Err(err) => {
                // Do not return error because 'no such file' because the file might be renamed and
                // no longer exists. This can happen when saving files on Vim. In this case, a file
                // create event will follow so the preview can be updated with the event.
                log::debug!("Could not open {:?} due to error: {}", path, err);
                return Ok(false);
            }
        };

        let msg = MessageToRenderer::Content { content: &content };
        self.renderer.send_message(msg)?;

        if !self.history.is_current(path) {
            self.renderer.set_title(&self.title(path));
        }

        Ok(true)
    }

    fn preview_new(&mut self, path: PathBuf) -> Result<()> {
        self.watcher.watch(&path)?; // Watch path at first since the file may not exist yet
        if self.preview(&path)? {
            self.history.push(path);
        }
        Ok(())
    }

    fn forward(&mut self) -> Result<()> {
        if let Some(path) = self.history.next() {
            log::debug!("Forward to next preview page: {:?}", path);
            self.preview(path)?;
            self.history.forward();
        }
        Ok(())
    }

    fn back(&mut self) -> Result<()> {
        if let Some(path) = self.history.prev() {
            log::debug!("Back to previous preview page: {:?}", path);
            self.preview(path)?;
            self.history.back();
        }
        Ok(())
    }

    fn reload(&mut self) -> Result<()> {
        if let Some(path) = self.history.current() {
            log::debug!("Reload current preview page: {:?}", path);
            self.preview(path)?;
        }
        Ok(())
    }

    fn open_file(&mut self) -> Result<()> {
        // Should we use directory of the current file?
        let cwd = env::current_dir()?;
        if let Some(path) = D::pick_file(&cwd, self.config.file_extensions()) {
            log::debug!("Previewing file chosen by dialog: {:?}", path);
            self.preview_new(path)?;
        }
        Ok(())
    }

    fn open_dir(&mut self) -> Result<()> {
        // Should we use directory of the current file?
        let cwd = env::current_dir()?;
        if let Some(path) = D::pick_dir(&cwd) {
            log::debug!("Watching directory chosen by dialog: {:?}", path);
            self.watcher.watch(&path)?;
        }
        Ok(())
    }

    fn handle_ipc_message(&mut self, message: MessageFromRenderer) -> Result<()> {
        match message {
            MessageFromRenderer::Init => {
                if self.options.debug {
                    self.renderer.send_message(MessageToRenderer::Debug)?;
                }

                self.renderer.send_message(MessageToRenderer::Config {
                    keymaps: self.config.keymaps(),
                    search: self.config.search(),
                })?;

                if let Some(path) = mem::take(&mut self.options.init_file) {
                    self.preview_new(path)?;
                }
            }
            MessageFromRenderer::Forward => self.forward()?,
            MessageFromRenderer::Back => self.back()?,
            MessageFromRenderer::Reload => self.reload()?,
            MessageFromRenderer::FileDialog => self.open_file()?,
            MessageFromRenderer::DirDialog => self.open_dir()?,
            MessageFromRenderer::Error { message } => {
                anyhow::bail!("Error reported from renderer: {}", message)
            }
        }
        Ok(())
    }

    pub fn handle_user_event(&mut self, event: UserEvent) -> Result<()> {
        match event {
            UserEvent::IpcMessage(msg) => self.handle_ipc_message(msg),
            UserEvent::FileDrop(mut path) => {
                log::debug!("Previewing file dropped into window: {:?}", path);
                if !path.is_absolute() {
                    path = path.canonicalize()?;
                }
                self.preview_new(path)?;
                Ok(())
            }
            UserEvent::WatchedFilesChanged(mut paths) => {
                log::debug!("Files changed: {:?}", paths);
                if let Some(current) = self.history.current() {
                    if paths.contains(current) {
                        self.preview(current)?;
                        return Ok(());
                    }
                }
                // Choose the last one to preview if the current file is not included in `paths`
                if let Some(mut path) = paths.pop() {
                    if !path.is_absolute() {
                        path = path.canonicalize()?;
                    }
                    if self.preview(&path)? {
                        self.history.push(path);
                    }
                }
                Ok(())
            }
            UserEvent::OpenLocalPath(mut path) => {
                if path.is_relative() {
                    if let Some(current_file) = self.history.current() {
                        if let Some(dir) = current_file.parent() {
                            path = dir.join(path).canonicalize()?;
                        }
                    }
                }
                let path = path;
                let is_markdown = self.config.file_extensions().matches(&path);
                if is_markdown {
                    log::debug!("Opening local markdown link clicked in WebView: {:?}", path);
                    self.preview_new(path)
                } else {
                    log::debug!("Opening local link item clicked in WebView: {:?}", path);
                    self.opener.open(&path)
                }
            }
            UserEvent::OpenExternalLink(link) => {
                log::debug!("Opening external link item clicked in WebView: {:?}", link);
                self.opener.open(&link)
            }
            UserEvent::Error(err) => Err(err),
        }
    }

    pub fn handle_menu_event(&mut self, id: <R::Menu as MenuItems>::ItemId) -> Result<AppControl> {
        let kind = self.menu.item_from_id(id)?;
        log::debug!("Menu item was clicked: {:?}", kind);
        match kind {
            MenuItem::Quit => return Ok(AppControl::Exit),
            MenuItem::Forward => self.forward()?,
            MenuItem::Back => self.back()?,
            MenuItem::Reload => self.reload()?,
            MenuItem::OpenFile => self.open_file()?,
            MenuItem::WatchDir => self.open_dir()?,
            MenuItem::Search => self.renderer.send_message(MessageToRenderer::Search)?,
            MenuItem::SearchNext => self.renderer.send_message(MessageToRenderer::SearchNext)?,
            MenuItem::SearchPrevious => {
                self.renderer.send_message(MessageToRenderer::SearchPrevious)?
            }
        }
        Ok(AppControl::Continue)
    }
}
