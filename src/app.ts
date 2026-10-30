import './polyfills';
import './engine-quirks';
import { CONFIG } from './config';
import { KeyHandler } from './navigation/key-handler';
import { PlaylistService } from './services/playlist-service';
import { EpgService } from './services/epg-service';
import { ChannelHealthService } from './services/channel-health';
import { StorageService } from './services/storage-service';
import {
  clearCachedCatalog,
  clearCachedPlaylist,
  flushCacheWrites,
} from './services/idb-cache';
import { SetupClient } from './services/setup-client';
import { SearchIndexPrewarmer } from './services/search-index-store';
import { CATALOG_STORE, EPG_STORE } from './services/idb-schema';
import type { SearchPrewarmSource } from './workers/tasks';
import { setServicePort } from './services/service-http';
import { isLunaAvailable, lunaRequest, type LunaRequestHandle } from './services/luna';
import { ChannelList } from './components/channel-list';
import { Player } from './components/player';
import { LivePreview } from './components/live-preview';
import { LiveHeader, type LiveMode } from './components/live-header';
import { LiveDwell } from './components/live-dwell';
import { LiveGuide } from './components/live-guide';
import { Settings, type SaveAction, type SourceTarget } from './components/settings';
import { Sidebar } from './components/sidebar';
import { type Section, sectionForView } from './components/sections';
import { Home } from './components/home';
import { SearchBox } from './components/search-box';
import { HomeButton } from './components/home-button';
import { Movies } from './components/movies';
import { Series } from './components/series';
import { Search } from './components/search';
import { showToast } from './components/toast';
import { showNumberEntry, hideNumberEntry } from './components/number-entry';
import { ReminderService } from './services/reminder-service';
import { StartupConnection } from './services/connection-check';
import { firstRunLanding } from './components/first-run';import { resetAppData } from './services/app-reset';
import { ReminderPrompt } from './components/reminder-prompt';
import { ReminderManager } from './components/reminder-manager';
import { ParentalControls } from './components/parental-controls';
import { ParentalPinPrompt } from './components/parental-pin-prompt';
import {
  liveParentalRequest,
  ParentalControlService,
  vodParentalRequest,
} from './services/parental-control';
import { setDisplayTz } from './utils/time';
import { initTheme, applyTheme, applyOverlayStyle, applyTextSize, applyInterfaceSize } from './services/theme-service';
import { applyAnimationMode } from './services/motion-service';
import { channelKey } from './utils/channel';
import { isSourceEnabled } from './utils/playlist';
import { truncate } from './utils/text';
import { $, show, hide } from './utils/dom';
import { createLogger, installGlobalErrorHandlers, logEnvironment } from './utils/logger';
import { FocusRing } from './navigation/focus-ring';
import { backStep, type PlayedFrom } from './navigation/back-route';
import { closeApp } from './utils/platform-exit';
import { Focus, type FocusScope } from './navigation/focus-scope';
import type {
  Action,
  NumberEvent,
  CatchupInfo,
  Channel,
  ChannelScope,
  EpgSource,
  PlaylistEntry,
} from './types';
import { getLocale, initLocale, resolveLocale, setLocale, t, tp } from './i18n';

const log = createLogger('App');

type ViewName = 'home' | 'channels' | 'player' | 'settings' | 'parental-controls' | 'reminders'
  | 'loading' | 'movies' | 'series' | 'search';

class App {
  private views!: Record<ViewName, HTMLElement>;
  private viewStack: ViewName[] = ['channels'];
  // Where Back from live playback returns: the page it started on.
  private playerReturn: PlayedFrom = 'channels';
  private channelList!: ChannelList;
  private player!: Player;
  private livePreview!: LivePreview;
  // Live: one header over the list and the Guide, the preview that follows
  // focus once it rests, and the Guide's time grid beside the groups.
  private liveHeader!: LiveHeader;
  private liveGuide!: LiveGuide;
  private liveMode: LiveMode = 'list';
  // In the Guide, whether the time grid or the groups column has the keys.
  private guideKeys: 'grid' | 'groups' = 'grid';
  private readonly liveDwell = new LiveDwell(CONFIG.PLAYER.LIVE_PREVIEW_DWELL_MS,
    (index) => {
      // A reminder asking to watch a channel holds the screen: the preview
      // waits under it and tunes once it closes on the row still focused.
      if (this.reminderPrompt.visible) {
        this.liveDwell.focus(index, this.livePreview.previewIndex);
        return;
      }
      // Resting on a locked channel asks for nothing: OK does.
      const channel = PlaylistService.getByIndex(index);
      if (channel && !ParentalControlService.decision(liveParentalRequest(channel, 'preview')).allowed) {
        this.livePreview.close();
        return;
      }
      this.livePreview.retune(index, {
        group: this.channelList.group,
        playlist: this.channelList.playlist || undefined,
      });
    });
  private settings!: Settings;
  private parentalControls!: ParentalControls;
  private parentalPinPrompt = new ParentalPinPrompt();
  private sidebar!: Sidebar;
  private reminderPrompt = new ReminderPrompt();
  private reminderManager!: ReminderManager;
  private home!: Home;
  private searchBox!: SearchBox;
  private homeButton!: HomeButton;
  private search!: Search;
  private movies!: Movies;
  private series!: Series;
  private lastSearchQuery = '';
  private enterChannelsAfterUploadSync = false;
  private remindersInitialized = false;
  private bundledServiceStarting = false;
  private serviceEventsSubscription: LunaRequestHandle | null = null;
  private deviceSetupSync = Promise.resolve();
  private playlistRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private playlistRefreshIntervalMs: number | null | undefined;
  private playlistRefreshPromise: Promise<void> | null = null;
  // The load confirmation toast owns the screen until loadData() settles.
  private loadingData = false;
  private epgRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private epgRefreshIntervalMs: number | null | undefined;
  private epgChannelReloadTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly searchPrewarm = new SearchIndexPrewarmer(() => this.searchPrewarmSources());
  // Home loads no channels: the first surface that needs them loads them.
  private channelsLoaded = false;
  private channelLoad: Promise<void> | null = null;
  // A reload Home deferred still owes its forced guide refresh.
  private forceEpgOnLoad = false;
  // Only the latest action waiting on the channels runs.
  private channelWaiter = 0;
  // Home's sign-in check, behind its connection banner.
  private readonly connection = new StartupConnection(
    () => StorageService.getPlaylists(),
    (issue, checking) => {
      this.home.setConnection(issue, checking);
      if (issue && !checking && this.isCurrentView('home')) this.home.focusAlert();
    },
  );

  async init(): Promise<void> {
    const done = log.time('init');
    log.info('Initializing app');
    await StorageService.init();
    ParentalControlService.reload();
    StorageService.setPlaylistsReplacedHandler((previous, next) =>
      ParentalControlService.reviewChangedSources(previous, next));
    ParentalControlService.setChallengeHandler(request =>
      this.parentalPinPrompt.showChallenge(request));
    StorageService.setWriteFailureHandler(() => showToast(t('app.saveFailed')));
    this.searchPrewarm.watchSourceWrites();
    initLocale(StorageService.getLocalePreference());
    applyAnimationMode(StorageService.getAnimationMode());
    const initialLoadingText = $('#loading-text');
    if (initialLoadingText) initialLoadingText.textContent = t('common.loading');
    const loadingTitle = $('#loading-title');
    if (loadingTitle) loadingTitle.textContent = CONFIG.APP_NAME;
    initTheme();
    this.views = {
      home: $('#view-home')!,
      channels: $('#view-channels')!,
      player: $('#view-player')!,
      settings: $('#view-settings')!,
      'parental-controls': $('#view-parental-controls')!,
      reminders: $('#view-reminders')!,
      movies: $('#view-movies')!,
      series: $('#view-series')!,
      search: $('#view-search')!,
      loading: $('#view-loading')!,
    };

    this.liveHeader = new LiveHeader({
      onMode: (mode) => this.setLiveMode(mode),
      onEdit: () => this.channelList.enterEditMode(),
      onLeave: () => Focus.base()?.enter('back'),
    });
    this.channelList = new ChannelList(
      $('#channel-browser')!,
      {
        guideMode: () => this.liveMode === 'guide',
        onRowFocus: (index) => this.onLiveRowFocus(index),
        onCount: (count) => this.liveHeader.setCount(count),
        onChannelSelect: (idx, catchup, scope, mode) =>
          this.livePreview.selectChannel(idx, catchup, scope, mode),
        onChannelsChanged: () => {
          this.player.syncCurrentIndex();
          this.scheduleEpgReload();
        },
        onEpgMappingChanged: () => this.scheduleEpgReload(),
        onEpgOffsetChanged: () => {
          void this.search.refreshPrograms();
        },
        authorizeEdit: proceed =>
          this.authorizeLiveEditing(t('settings.editChannelList'), proceed),
        onEnterManagement: () => this.livePreview?.close(),
      },
    );
    this.player = new Player(this.views.player, () => this.goUp('player'), (idx, catchupStart) => {
      this.channelList.setPlaying(idx, catchupStart);
      // Zapping full screen moves where Back returns to; the preview never does.
      if (idx >= 0 && this.isCurrentView('player') && !this.player.isInLivePreview()) {
        this.channelList.setWatching(idx);
      }
      if (this.livePreview?.isShowing) this.channelList.render(false);
    },
    () => !this.sidebar.visible,
    () => {
      this.sidebar.refresh();
    }, () => {
      this.livePreview?.refresh();
    },
    () => this.livePreview?.canResumePlayback() ?? true,
    (channel, action, preview, ask = true) => {
      const request = liveParentalRequest(channel, preview ? 'preview' : 'play');
      if (!ask && !ParentalControlService.decision(request).allowed) return false;
      return ParentalControlService.authorize(request, () => {
        if (!preview && !this.isCurrentView('player')) this.showView('player');
        action();
      });
    },
    (item, action) => ParentalControlService.authorize(
      vodParentalRequest(item, item.resumeSecs > 0 ? 'resume' : 'play'),
      () => {
        if (!this.isCurrentView('player')) this.showView('player');
        action();
      },
    ),
    {
      isFavorite: (channel) => StorageService.getFavorites().includes(channelKey(channel)),
      toggleFavorite: (channel) => this.toggleChannelFavorite(channel),
    });
    this.liveGuide = new LiveGuide($('#live-guide')!, {
      scope: () => ({
        group: this.channelList.group,
        playlist: this.channelList.playlist || undefined,
      }),
      play: (index, catchup, scope) => {
        if (!catchup) this.channelList.setWatching(index);
        this.playChannel(index, catchup, scope);
      },
      watching: () => this.channelList.watching,
      onLeaveLeft: () => this.focusGuideGroups(),
      onLeaveUp: () => this.liveHeader.enter(),
    });
    this.reminderManager = new ReminderManager(this.views.reminders, () => this.goUp('reminders'));
    this.settings = new Settings(
      this.views.settings,
      (action) => this.onSettingsSaved(action),
      () => this.player.syncCurrentIndex(),
      () => this.openReminderManager(),
      () => this.openParentalControls(),
      (name, proceed) => this.authorizeLiveEditing(name, proceed),
      (id, proceed, turnOff) => this.authorizeSourceRemoval(id, proceed, turnOff),
    );
    this.parentalControls = new ParentalControls(
      this.views['parental-controls'],
      () => this.goUp('parental-controls'),
      done => this.parentalPinPrompt.showChange(done),
      done => this.parentalPinPrompt.showCreate(done),
    );

    this.player.init($('#video-player') as HTMLVideoElement);
    this.livePreview = new LivePreview($('#live-preview')!, {
      channelView: this.views.channels,
      player: this.player,
      channelList: this.channelList,
      getCurrentView: () => this.viewStack[this.viewStack.length - 1],
      showChannels: preserveFocus => this.showView('channels', preserveFocus),
      showPlayer: () => this.showView('player'),
      playFullscreen: (index, catchup, scope) => this.playChannel(index, catchup, scope),
      expansionBlocked: () => this.reminderPrompt.visible,
      isFavorite: channel => StorageService.getFavorites().includes(channelKey(channel)),
      suppressed: () => this.liveMode === 'guide',
      onWatch: index => this.channelList.setWatching(index),
    });
    window.addEventListener('resize', () => this.livePreview.refreshLayout());
    ParentalControlService.subscribe(concealmentChanged =>
      this.onParentalLocksChanged(concealmentChanged));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.parentalPinPrompt.dismiss();
        // Whoever comes back must not find the manager open without a PIN.
        if (this.isCurrentView('parental-controls')) this.leaveParentalControls();
        ParentalControlService.lock('backgrounded');
        this.livePreview.suspend();
      } else {
        this.livePreview.refresh();
        this.livePreview.refreshLayout();
      }
    });

    this.sidebar = new Sidebar(
      this.views.player,
      () => this.player.getCurrentIndex(),
      (idx, catchup, scope) => this.playChannel(idx, catchup, scope),
      () => this.player.getCurrentCatchupStart(),
    );

    this.movies = new Movies(this.views.movies, {
      onBack: () => this.goUp('movies'),
      onPlayVod: (req) => {
        this.player.playVod({
          ...req,
          onBack: () => {
            this.showView('movies');
            this.movies.refreshPlaybackState();
          },
        });
      },
    });
    this.series = new Series(this.views.series, {
      onBack: () => this.goUp('series'),
      onPlayVod: (req) => {
        this.player.playVod({
          ...req,
          onBack: () => {
            this.showView('series');
            this.series.refreshPlaybackState();
          },
        });
      },
    });
    this.search = new Search($('.search-results-host', this.views.search)!, {
      onFocusBox: () => this.searchBox.focus(),
      onReleaseBox: () => this.searchBox.release(),
      // Step back out to the search box, where a second Back goes Home.
      onBack: () => this.searchBox.focus(),
      onPickRecent: (query) => {
        this.searchBox.setQuery(query);
        this.searchBox.release();
        this.handleSearchQuery(query);
        this.search.focusFirstResult();
      },
      onPlayChannel: (idx, catchup) => { this.searchBox.release(); this.playChannel(idx, catchup); },
      onOpenMovie: (account, vod) => {
        this.searchBox.release();
        this.showView('movies');
        this.movies.openItem(account, vod, () => this.showView('search'))
          .catch((err) => log.error(
            'Open movie failed',
            'event=xtream.view.open.failed',
            'operation=movie_detail',
            err,
          ));
      },
      onOpenSeries: (account, series) => {
        this.searchBox.release();
        this.showView('series');
        this.series.openItem(account, series, () => this.showView('search'))
          .catch((err) => log.error(
            'Open series failed',
            'event=xtream.view.open.failed',
            'operation=series_detail',
            err,
          ));
      },
    });
    this.searchBox = new SearchBox($('.search-box-host', this.views.search)!, {
      onQuery: (query) => this.handleSearchQuery(query),
      onLeave: () => {
        if (this.lastSearchQuery.trim()) {
          this.search.focusFirstResult();
          return true;
        }
        return this.search.focusRecent();
      },
      onBack: () => this.goUp('search'),
    });
    this.home = new Home(this.views.home, {
      onOpenSection: (section, via) => this.selectSection(section, via),
      onPlayNumber: (number) => this.withChannels(() => {
        const index = number - 1;
        if (index >= 0 && index < PlaylistService.channels.length) this.playChannel(index);
      }),
      onSelectAccount: (id) => this.selectXtreamAccount(id),
      onLockNow: () => ParentalControlService.lock('lock-now'),
      onBack: () => this.goUp('home'),
      onAddSource: (kind, via) =>
        this.openSettingsAt({ kind: kind === 'xtream' ? 'add-xtream' : 'add-playlist' }, via),
      onRetryConnection: () => void this.connection.verify(),
      onEditAccount: (issue, via) =>
        this.openSettingsAt({ kind: 'account', accountId: issue.accountId, state: issue.state }, via),
      loadSetupInfo: () => SetupClient.getInfo(),
    });
    this.homeButton = new HomeButton(() => this.selectSection('home', 'pointer'));

    KeyHandler.init();
    KeyHandler.setHandler((action, event) => {
      this.handleKey(action, event);
      // Any key ends a pointer entry's wait, even one that acted elsewhere.
      FocusRing.reveal('key', action);
      FocusRing.sync();
      Focus.input();
    });
    this.initFocusScopes();
    FocusRing.install(() => {
      const owner = Focus.owner();
      return { root: owner?.root() ?? null, modal: !!owner?.modal, id: owner?.id };
    });
    KeyHandler.setChannelCount(() => PlaylistService.channels.length);

    this.initSidebarTrigger();

    done();
    this.enterChannelsAfterUploadSync = StorageService.getPlaylists().length === 0;
    this.bindBundledServiceLifecycle();
    this.bindReminderLifecycle();
    // Register a retail-safe callback immediately. If Developer Mode is
    // detected below, the same named activities are replaced with alerts.
    ReminderService.reschedulePending();
    await this.loadData(false, 'launch');
    // Cold launch from a "Watch now" alert: channels are loaded now, so tune.
    this.handleLaunchParams(this.coldLaunchParams());
    // Spawning the service process can synchronously stall Luna on a cold TV.
    // Keep LAN setup off the critical path so cached channels render first.
    const bundledServiceReady = this.startBundledService();
    void bundledServiceReady
      .then((started) => started ? this.finishBundledServiceInit() : undefined)
      .catch(err => log.error('Bundled service initialization failed:', err));
  }

  /**
   * Tie the bundled service's lifetime to the app's foreground state. The
   * service holds an open LAN HTTP port and a Luna keepAlive activity, so we
   * stop it when the app is backgrounded (visibility → hidden) so neither
   * the port nor the service process lingers across the rest of webOS. On
   * visibility → visible we restart it and resubscribe.
   *
   * visibilitychange is reliable on this firmware (verified empirically; the
   * Player module's suspend/resume listens to the same event).
   */
  private bindBundledServiceLifecycle(): void {
    let lastVisibility = document.visibilityState;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === lastVisibility) return;
      lastVisibility = document.visibilityState;
      if (document.visibilityState === 'hidden') {
        void this.flushUserData('background');
        log.info('App backgrounded — stopping bundled service');
        this.stopBundledService();
      } else if (document.visibilityState === 'visible') {
        if (this.bundledServiceStarting) {
          log.info('App foregrounded while bundled service start is pending');
          return;
        }
        log.info('App foregrounded — restarting bundled service');
        void this.startBundledService()
          .then((started) => started ? this.finishBundledServiceInit() : undefined)
          .catch(err => log.error('Bundled service restart failed:', err));
      }
    });
  }

  private async flushUserData(reason: 'background' | 'exit'): Promise<boolean> {
    try {
      await Promise.all([StorageService.flush(), flushCacheWrites()]);
      log.info(
        'User data flush completed',
        'event=persistence.user.flush.completed',
        'operation=flush',
        `reason=${reason}`,
      );
      return true;
    } catch (err) {
      log.error(
        'User data flush failed',
        'event=persistence.user.flush.failed',
        'operation=flush',
        `reason=${reason}`,
        err,
      );
      return false;
    }
  }

  private async exitApp(): Promise<void> {
    if (!await this.flushUserData('exit')) {
      showToast(t('app.saveFailed'));
      return;
    }
    this.stopBundledService();
    closeApp();
  }

  private cancelServiceEventsSubscription(): void {
    if (!this.serviceEventsSubscription) return;
    try {
      this.serviceEventsSubscription.cancel();
    } catch (e) {
      log.warn('serviceEvents cancellation threw:', e);
    }
    this.serviceEventsSubscription = null;
  }

  /**
   * Fire-and-forget Luna call to gracefully shut down the bundled service.
   * The service closes its HTTP listener, releases its keepAlive activity,
   * and lets the Node process exit so neither the port nor the process
   * persists in the background.
   */
  private stopBundledService(): void {
    this.cancelServiceEventsSubscription();
    if (!isLunaAvailable()) {
      setServicePort(null);
      return;
    }
    try {
      lunaRequest(`luna://${CONFIG.SERVICE_ID}`, {
        method: 'stop',
        parameters: {},
        onSuccess: (resp: unknown) => log.info('Bundled service stop onSuccess:', JSON.stringify(resp)),
        onFailure: (err: unknown) => log.warn('Bundled service stop onFailure:', JSON.stringify(err)),
      });
    } catch (e) {
      log.warn('stopBundledService threw:', e);
    }
    // Forget the runtime port — next start will set it again via setServicePort.
    setServicePort(null);
  }

  /**
   * Ask the webOS Luna service bus to start the bundled webOS JS service
   * (see bundled-service/). On non-webOS environments (desktop preview, e2e)
   * this is a no-op — the bundled service is only available on device.
   *
   * We log onSuccess/onFailure explicitly so device logs (ares-inspect or
   * ares-monitor-log) show what happened, instead of guessing from silence.
   */
  private async startBundledService(): Promise<boolean> {
    if (this.bundledServiceStarting) return false;
    this.bundledServiceStarting = true;
    if (!isLunaAvailable()) {
      this.bundledServiceStarting = false;
      log.debug('webOS Luna service bus not available — skipping bundled service start');
      return false;
    }
    log.info('Calling luna://' + CONFIG.SERVICE_ID + '/start ...');
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (started: boolean, why: string): void => {
        if (settled) return;
        settled = true;
        this.bundledServiceStarting = false;
        log.info('startBundledService settled:', why);
        resolve(started);
      };
      const timer = setTimeout(() => finish(false, 'timeout after 3s'), 3000);
      // NOTE: no trailing '/' on the URI — the Luna client appends '/' + method,
      // so a trailing slash here produces 'luna://.../service//start' (double
      // slash) which Luna treats as a missing method and returns onFailure.
      try {
        lunaRequest(`luna://${CONFIG.SERVICE_ID}`, {
          method: 'start',
          parameters: {},
          onSuccess: (resp: unknown) => {
            clearTimeout(timer);
            const lateSuccess = settled;
            if (document.visibilityState === 'hidden') {
              log.info('Bundled service started after app was hidden — stopping it');
              this.stopBundledService();
              finish(false, 'stopped after app hidden');
              return;
            }
            if (resp && typeof resp === 'object' && 'port' in resp) {
              const p = (resp as { port?: unknown }).port;
              if (typeof p === 'number') setServicePort(p);
            }
            log.info('Bundled service start onSuccess:', JSON.stringify(resp));
            finish(true, 'onSuccess');
            if (lateSuccess) {
              void this.finishBundledServiceInit()
                .catch(err => log.error('Late bundled service initialization failed:', err));
            }
          },
          onFailure: (err: unknown) => {
            clearTimeout(timer);
            log.error('Bundled service start onFailure:', JSON.stringify(err));
            finish(false, 'onFailure');
          },
        });
      } catch (e) {
        clearTimeout(timer);
        log.error('Bundled service start threw:', e);
        finish(false, 'threw');
      }
    });
  }

  private async finishBundledServiceInit(): Promise<void> {
    if (document.visibilityState === 'hidden') return;
    this.subscribeToServiceEvents();
    if (!this.remindersInitialized) {
      const initialized = await this.queryDevMode();
      ReminderService.reschedulePending();
      this.remindersInitialized = initialized;
    }
    await this.queueDeviceSetupSync();
    void SetupClient.publishState();
    await this.settings.refreshSetupInfo();
    if (this.home.showsFirstRun) await this.home.refreshSetupInfo();
    await this.settings.refreshUploads();
    await this.loadChannelsAfterFirstUpload();
  }

  private queueDeviceSetupSync(): Promise<void> {
    this.deviceSetupSync = this.deviceSetupSync
      .then(async () => {
        if (await SetupClient.applyPendingActions()) {
          await this.onSettingsSaved('reload');
        }
      })
      .catch(err => log.error('Device setup sync failed:', err));
    return this.deviceSetupSync;
  }

  private async loadChannelsAfterFirstUpload(): Promise<void> {
    if (this.enterChannelsAfterUploadSync &&
        StorageService.getPlaylists().length > 0) {
      this.enterChannelsAfterUploadSync = false;
      await this.loadData(false, this.isCurrentView('home') ? 'launch' : 'channels');
    }
  }

  /**
   * Ask the bundled service whether Developer Mode is on. In dev mode reminders
   * fire an interactive system alert instead of the passive toast + in-app
   * prompt. Guarded: with no Luna bus (desktop/e2e) dev-mode stays false and we
   * keep the retail in-app path.
   */
  private async queryDevMode(): Promise<boolean> {
    ReminderService.setDevMode(false);
    if (!isLunaAvailable()) {
      log.debug('Luna unavailable — dev-mode alert disabled, using in-app prompt');
      return false;
    }
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (initialized: boolean): void => {
        if (!settled) {
          settled = true;
          resolve(initialized);
        }
      };
      const timer = setTimeout(() => finish(false), 3000);
      try {
        lunaRequest(`luna://${CONFIG.SERVICE_ID}`, {
          method: 'getDevMode',
          parameters: {},
          onSuccess: (resp: unknown) => {
            clearTimeout(timer);
            const lateSuccess = settled;
            if (document.visibilityState === 'hidden') {
              finish(false);
              return;
            }
            const dev = !!(resp && typeof resp === 'object' && (resp as { devmode?: unknown }).devmode);
            ReminderService.setDevMode(dev);
            log.info('getDevMode:', dev);
            finish(true);
            if (lateSuccess) {
              this.remindersInitialized = true;
              ReminderService.reschedulePending();
            }
          },
          onFailure: (err: unknown) => {
            clearTimeout(timer);
            log.warn('getDevMode onFailure:', JSON.stringify(err));
            finish(false);
          },
        });
      } catch (e) {
        clearTimeout(timer);
        log.warn('getDevMode threw:', e);
        finish(false);
      }
    });
  }

  /**
   * Subscribe to the bundled service's `serviceEvents` push channel. Upload
   * changes refresh the managed upload list; phone setup changes consume the
   * queued Playlist, Xtream, or EPG action and reload channel data. No polling.
   *
   * Subscription is best-effort: if Luna isn't available (desktop/e2e) or
   * the subscribe call fails, we silently fall back to the explicit
   * refresh calls that bundled-service initialization runs on open.
   */
  private subscribeToServiceEvents(): void {
    if (!isLunaAvailable()) {
      log.debug('Luna unavailable — service event subscription skipped');
      return;
    }
    this.cancelServiceEventsSubscription();
    log.info('Subscribing to luna://' + CONFIG.SERVICE_ID + '/serviceEvents ...');
    try {
      this.serviceEventsSubscription = lunaRequest(`luna://${CONFIG.SERVICE_ID}`, {
        method: 'serviceEvents',
        subscribe: true,
        parameters: {},
        onSuccess: (resp: unknown) => {
          log.info('serviceEvents push:', JSON.stringify(resp));
          if (resp && typeof resp === 'object' &&
              (resp as { subscribed?: unknown }).subscribed === true) return;
          if (resp && typeof resp === 'object' &&
              (resp as { event?: unknown }).event === 'setup-changed') {
            void this.queueDeviceSetupSync();
            return;
          }
          void this.settings.refreshUploads()
            .then(() => this.loadChannelsAfterFirstUpload())
            .catch(err => log.error('Upload event refresh failed:', err));
        },
        onFailure: (err: unknown) => {
          log.warn('serviceEvents subscription failed:', JSON.stringify(err));
        },
      });
    } catch (e) {
      log.warn('serviceEvents subscribe threw:', e);
    }
  }

  /**
   * Push the saved display-timezone mode + the EPG's source offset into the
   * time formatter. Display only; safe to re-run any time. Prefers the offset
   * from the freshly-loaded feed, persists it, and falls back to the last-known
   * value — so feed mode renders correctly before the EPG has reloaded. The
   * formatter degrades 'feed' to 'device' while the offset is still unknown.
   */
  private applyDisplayTz(): void {
    const offset = EpgService.tzOffsetMinutes ?? StorageService.getEpgTzOffset();
    if (EpgService.tzOffsetMinutes != null) StorageService.setEpgTzOffset(EpgService.tzOffsetMinutes);
    setDisplayTz(StorageService.getTzMode(), offset);
  }

  private epgSources(): EpgSource[] {
    if (!StorageService.getPlaylists().some(isSourceEnabled)) return [];
    const manual = StorageService.getManualEpgSources()
      .map(source => ({ ...source, kind: 'manual' as const }));
    const discovered = PlaylistService.epgSources;
    const sources: EpgSource[] = [...manual, ...discovered];
    const offsets = StorageService.getEpgOffsets();
    return sources.map(source => ({ ...source, offsetMinutes: offsets[source.url] ?? 0 }));
  }

  /**
   * The guide covers the eligible channels, so a visibility edit and a
   * mapping edit both have to re-derive it. Narrowing the selection is served
   * from the cache; only a selection that grew refetches.
   */
  private scheduleEpgReload(): void {
    if (this.epgChannelReloadTimer !== null) clearTimeout(this.epgChannelReloadTimer);
    this.epgChannelReloadTimer = setTimeout(() => {
      this.epgChannelReloadTimer = null;
      const sources = this.epgSources();
      if (!sources.length) return;
      void EpgService.load(
        sources,
        PlaylistService.getEpgEligibleChannels(),
        () => this.refreshEpgDependentViews(),
      )
        .then(() => {
          this.refreshEpgDependentViews();
        })
        .catch(err => log.error('EPG reload after a channel change failed:', err));
    }, CONFIG.EPG.CHANNEL_CHANGE_RELOAD_DELAY);
  }

  private stopEpgRefresh(): void {
    if (this.epgChannelReloadTimer !== null) {
      clearTimeout(this.epgChannelReloadTimer);
      this.epgChannelReloadTimer = null;
    }
    this.epgRefreshIntervalMs = undefined;
    if (this.epgRefreshTimer !== null) {
      clearTimeout(this.epgRefreshTimer);
      this.epgRefreshTimer = null;
    }
  }

  private scheduleEpgRefresh(force = false, delayOverride?: number): void {
    const intervalMs = StorageService.getEpgRefreshIntervalMs();
    const shouldRun = intervalMs !== null && this.channelsLoaded && this.epgSources().length > 0;
    if (!force
      && this.epgRefreshIntervalMs === intervalMs
      && ((shouldRun && this.epgRefreshTimer !== null)
        || (!shouldRun && this.epgRefreshTimer === null))) {
      return;
    }
    if (this.epgRefreshTimer !== null) {
      clearTimeout(this.epgRefreshTimer);
      this.epgRefreshTimer = null;
    }
    this.epgRefreshIntervalMs = intervalMs;
    if (!shouldRun || intervalMs === null) return;
    const delayMs = delayOverride ?? EpgService.getNextRefreshDelayMs(intervalMs);
    this.epgRefreshTimer = setTimeout(() => {
      this.epgRefreshTimer = null;
      EpgService.refresh(() => this.refreshEpgDependentViews())
        .then((complete) => {
          this.refreshEpgDependentViews();
          this.scheduleEpgRefresh(
            true,
            complete ? undefined : StorageService.getEpgRefreshIntervalMs() ?? undefined,
          );
        }, (err) => {
          log.error('EPG refresh failed:', err);
          this.scheduleEpgRefresh(true, StorageService.getEpgRefreshIntervalMs() ?? undefined);
        });
    }, delayMs);
  }

  private stopPlaylistRefresh(): void {
    if (this.playlistRefreshTimer !== null) {
      clearTimeout(this.playlistRefreshTimer);
      this.playlistRefreshTimer = null;
    }
    this.playlistRefreshIntervalMs = undefined;
  }

  private schedulePlaylistRefresh(force = false, delayOverride?: number): void {
    const intervalMs = StorageService.getPlaylistRefreshIntervalMs();
    const shouldRun = intervalMs !== null && this.channelsLoaded
      && StorageService.getPlaylists().some(isSourceEnabled);
    if (!force
      && this.playlistRefreshIntervalMs === intervalMs
      && ((shouldRun && this.playlistRefreshTimer !== null)
        || (!shouldRun && this.playlistRefreshTimer === null))) {
      return;
    }
    if (this.playlistRefreshTimer !== null) {
      clearTimeout(this.playlistRefreshTimer);
      this.playlistRefreshTimer = null;
    }
    this.playlistRefreshIntervalMs = intervalMs;
    if (!shouldRun || intervalMs === null) return;
    const delayMs = delayOverride ?? PlaylistService.getNextRefreshDelayMs(intervalMs);
    this.playlistRefreshTimer = setTimeout(() => {
      this.playlistRefreshTimer = null;
      void this.queuePlaylistRefresh();
    }, delayMs);
  }

  private queuePlaylistRefresh(): Promise<void> {
    if (this.playlistRefreshPromise) return this.playlistRefreshPromise;
    const onSettled = () => {
      this.playlistRefreshPromise = null;
      this.schedulePlaylistRefresh(
        true,
        StorageService.getPlaylistRefreshIntervalMs() ?? undefined,
      );
    };
    this.playlistRefreshPromise = this.refreshPlaylistInBackground()
      .then(() => {
        onSettled();
      }, (err) => {
        onSettled();
        throw err;
      });
    return this.playlistRefreshPromise;
  }

  private async refreshPlaylistInBackground(): Promise<void> {
    try {
      if (!StorageService.getPlaylists().some(isSourceEnabled)) return;
      await PlaylistService.refresh(undefined, { preserveOnFailure: true });
      this.player.syncCurrentIndex();
      await ChannelHealthService.initialize();

      const epgSources = this.epgSources();
      if (epgSources.length) {
        await EpgService.load(
          epgSources,
          PlaylistService.getEpgEligibleChannels(),
          () => this.refreshEpgDependentViews(),
        );
        await EpgService.refresh(() => this.refreshEpgDependentViews());
        this.refreshEpgDependentViews();
      } else {
        EpgService.reset();
        this.refreshEpgDependentViews();
      }
      this.scheduleEpgRefresh(true);

      this.syncSources();
      if (this.isCurrentView('home')) this.home.render();
      this.channelList.render();
      this.sidebar.refresh();
      this.livePreview?.refresh();
      this.showLiveCategoryNotices();
    } catch (err) {
      log.error('Automatic playlist refresh failed:', err);
    }
  }

  // The sections, accounts, and search scope follow the enabled sources.
  private syncSources(): void {
    const playlists = StorageService.getPlaylists();
    const hasXtream = playlists.some((p) => p.source === 'xtream' && isSourceEnabled(p));
    const accounts = playlists
      .filter((p) => p.source === 'xtream' && p.xtream && isSourceEnabled(p));
    const account = this.activeXtreamAccount();
    this.home.setSources(hasXtream, accounts, account);
    this.home.setFirstRun(!playlists.length);
    const issue = this.connection.issue;
    if (issue && !accounts.some((a) => a.id === issue.accountId)) this.connection.clear();
    this.searchBox.setPlaceholder(!!account);
  }

  // `launch`: the first load lands on Home, which only checks the connection
  // (or on Live, by a hidden preference, or when auto-play resumes a channel);
  // a reload stays on Live. `section` loads the channels for the section
  // being opened, and `quiet` for a due reminder, without changing the view.
  private async loadData(
    forceEpgRefresh = false,
    landing: 'launch' | 'channels' | 'section' | 'quiet' = 'channels',
  ): Promise<void> {
    const done = log.time('loadData');
    const quiet = landing === 'quiet';
    this.loadingData = !quiet;
    if (!quiet) show(this.views.loading);
    this.stopEpgRefresh();
    this.stopPlaylistRefresh();
    if (this.playlistRefreshPromise) await this.playlistRefreshPromise;

    this.applyDisplayTz();

    try {
      const playlists = StorageService.getPlaylists();
      log.info('Configured playlists:', playlists.length);
      const firstRun = firstRunLanding(playlists, landing, StorageService.getStartOnLive());
      if (firstRun) {
        log.info('No playlists configured — opening', firstRun);
        this.connection.clear();
        // Clear in-memory state so the channel list does not show stale
        // channels if the user navigates back from settings (e.g. with BACK).
        PlaylistService.reset();
        EpgService.reset();
        this.channelsLoaded = true;
        // No account at all: drop Movies/Series (Xtream-only) and any stale
        // account avatars.
        this.syncSources();
        this.channelList.render();
        // Home shows the first run; started on Live, Settings opens instead.
        if (firstRun === 'home') {
          this.goHome();
        } else {
          this.showView('settings');
          this.settings.render();
          showToast(t('app.welcome'));
        }
        return;
      }

      if (landing === 'launch' && this.startsOnHome()) {
        this.unloadChannels(forceEpgRefresh);
        this.syncSources();
        this.channelList.render();
        this.goHome();
        this.scanReminders();
        void this.verifyConnection();
        return;
      }

      const loadingText = $('#loading-text');
      if (loadingText) loadingText.textContent = t('app.loadingChannels');
      let lastProgressAt = 0;
      await PlaylistService.load(progress => {
        if (!loadingText) return;
        const now = Date.now();
        if (now - lastProgressAt < 250) return;
        lastProgressAt = now;
        loadingText.textContent = t('app.loadingChannelsProgress', {
          processed: progress.channelsProcessed,
          kept: progress.channelsKept,
        });
      });
      this.player.syncCurrentIndex();
      await ChannelHealthService.initialize();
      log.info('Channels loaded:', PlaylistService.channels.length,
        '| groups:', PlaylistService.groups.length,
        '| epgSources:', PlaylistService.epgSources);
      const epgSources = this.epgSources();
      if (epgSources.length) log.info('Using EPG sources:', epgSources);
      else {
        log.warn('No EPG sources configured');
        EpgService.reset();
      }
      const epgChannels = PlaylistService.getEpgEligibleChannels();
      if (epgSources.length) {
        await EpgService.restoreCached(epgSources, epgChannels);
      }

      this.channelsLoaded = true;
      this.syncSources();

      if (landing === 'section' || quiet) {
        this.channelList.render();
      } else if (landing === 'launch' && !StorageService.getStartOnLive()) {
        this.channelList.render();
        this.goHome();
      } else {
        this.showView('channels');
        this.channelList.render();
      }

      if (!quiet) showToast(tp('app.channelsLoaded', PlaylistService.channels.length));
      // Let the load confirmation finish before a new-category notice replaces it.
      setTimeout(() => this.showLiveCategoryNotices(), 3000);

      this.scanReminders();
      ReminderService.reschedulePending();

      if (StorageService.getAutoPlay() && (landing === 'launch' || landing === 'channels')) {
        // The per-stream key survives customization and provider reshuffles.
        const lastCh = PlaylistService.resolveLastChannelIndex(
          StorageService.getLastChannelKey(),
          StorageService.getLastChannel(),
        );
        const last = PlaylistService.channels[lastCh];
        // A locked channel must not open a PIN prompt over a cold start.
        if (last && ParentalControlService.decision(liveParentalRequest(last)).allowed) {
          log.info('Auto-play resuming last channel index', lastCh);
          this.playChannel(lastCh);
        }
      }

      if (epgSources.length) {
        if (forceEpgRefresh) {
          EpgService.refresh(() => this.refreshEpgDependentViews(), true)
            .then(() => {
              this.refreshEpgDependentViews();
              this.scheduleEpgRefresh(
                true,
                StorageService.getEpgRefreshIntervalMs() ?? undefined,
              );
            }, (err) => {
              log.error('EPG load failed:', err);
              this.scheduleEpgRefresh(
                true,
                StorageService.getEpgRefreshIntervalMs() ?? undefined,
              );
            });
        } else if (StorageService.getEpgRefreshIntervalMs() === null) {
          EpgService.refresh(() => this.refreshEpgDependentViews())
            .then(() => {
              this.refreshEpgDependentViews();
            }, err => log.error('Initial EPG load failed:', err));
        } else {
          this.scheduleEpgRefresh(true);
        }
      }
      this.schedulePlaylistRefresh(true);
      this.searchPrewarm.schedule('startup');
    } catch (err) {
      log.error('loadData failed:', err);
      if (quiet) return;
      this.showView('settings');
      this.settings.render();
      showToast(t('app.loadFailed'));
    } finally {
      if (!quiet) {
        this.loadingData = false;
        hide(this.views.loading);
      }
      done();
    }
  }

  // Auto-play resumes a channel at launch, so it needs the channels at once.
  private startsOnHome(): boolean {
    return !StorageService.getStartOnLive() && !StorageService.getAutoPlay();
  }

  // Home starts with no channels; a reload drops any already loaded.
  private unloadChannels(forceEpgRefresh: boolean): void {
    if (this.channelsLoaded) {
      PlaylistService.reset();
      EpgService.reset();
      this.player.syncCurrentIndex();
    }
    this.channelsLoaded = false;
    this.forceEpgOnLoad = this.forceEpgOnLoad || forceEpgRefresh;
  }

  private ensureChannels(quiet = false): Promise<void> {
    if (this.channelsLoaded) return Promise.resolve();
    if (!this.channelLoad) {
      const force = this.forceEpgOnLoad;
      this.forceEpgOnLoad = false;
      this.channelLoad = this.loadData(force, quiet ? 'quiet' : 'section')
        .then(() => { this.channelLoad = null; });
    }
    return this.channelLoad;
  }

  // Run `action` once the channels are loaded, loading them first if Home
  // skipped them. A failed load, a newer request, or a view change drops it.
  private withChannels(action: () => void): void {
    if (this.channelsLoaded) {
      action();
      return;
    }
    const waiter = ++this.channelWaiter;
    const view = this.viewStack[this.viewStack.length - 1];
    void this.ensureChannels().then(() => {
      if (this.channelsLoaded && waiter === this.channelWaiter && this.isCurrentView(view)) action();
    });
  }

  // Home's only request: does each Xtream account still sign in? A failure
  // shows Home's banner until a check passes.
  private verifyConnection(): Promise<void> {
    return this.connection.verify();
  }

  // Settings' Sources page from Home: an Add flow, or the account a failed
  // sign-in names. Settings needs the channels, which Home skipped; a load
  // that fails opens Settings itself, and the account still gets the keys.
  private openSettingsAt(target: SourceTarget, via: 'key' | 'pointer'): void {
    const open = (): void => {
      if (!this.isCurrentView('settings')) this.selectSection('settings', via);
      this.settings.openSource(target);
    };
    if (this.channelsLoaded) {
      open();
      return;
    }
    const waiter = ++this.channelWaiter;
    void this.ensureChannels().then(() => {
      if (waiter !== this.channelWaiter) return;
      if (this.isCurrentView('home') || this.isCurrentView('settings')) open();
    });
  }

  // New Live categories are announced only over the channel list, never over
  // fullscreen playback; otherwise they wait for the next visit.
  private showLiveCategoryNotices(): void {
    if (this.loadingData || !this.isCurrentView('channels')
      || !PlaylistService.hasLiveCategoryNotices()) return;
    const notices = PlaylistService.takeLiveCategoryNotices();
    const messages = notices.map(notice =>
      tp('liveCategories.newToast', notice.count, { name: notice.accountName }));
    log.info('Xtream Live categories announced', 'event=xtream.category_filter.announced',
      `count=${String(notices.reduce((sum, notice) => sum + notice.count, 0))}`,
      `items=${String(notices.length)}`);
    showToast(messages.join(' '), 3000 * messages.length);
  }

  private isCurrentView(name: ViewName): boolean {
    return this.viewStack[this.viewStack.length - 1] === name;
  }

  private leaveParentalControls(): void {
    this.settings.render();
    this.showView('settings');
  }

  // A channel row took focus in Live: the preview follows once it rests.
  private onLiveRowFocus(index: number | null): void {
    if (index === null || !this.isCurrentView('channels') || this.channelList.isEditing) {
      this.liveDwell.cancel();
      return;
    }
    this.liveDwell.focus(index, this.livePreview.previewIndex);
  }

  // Live's switch: the list (with the preview) or the Guide, on the same group.
  private setLiveMode(mode: LiveMode): void {
    this.liveDwell.cancel();
    if (mode === 'list') {
      this.liveMode = 'list';
      this.liveGuide.hide();
      this.channelList.render();
      this.showView('channels', false, true);
      return;
    }
    this.withChannels(() => {
      const index = this.player.getCurrentIndex();
      this.liveMode = 'guide';
      this.guideKeys = 'grid';
      this.sidebar.hide();
      this.player.stop();
      this.channelList.render(false);
      this.liveGuide.show(index);
      this.showView('channels', true);
      this.liveGuide.enter();
      EpgService.refresh(() => this.refreshEpgDependentViews())
        .then(() => this.refreshEpgDependentViews());
    });
  }

  // In the Guide: the groups column takes the keys.
  private focusGuideGroups(): void {
    this.guideKeys = 'groups';
    this.channelList.focusGroups();
  }

  // In the Guide: the time grid takes the keys.
  private focusGuideGrid(): void {
    this.guideKeys = 'grid';
    this.liveGuide.enter();
  }

  // Live's header sits over the list and the Guide; the Guide's grid shows
  // in place of the rows and the preview.
  private placeLiveHeader(name: ViewName): void {
    if (name !== 'channels') {
      this.liveHeader.detach();
      return;
    }
    const guide = this.liveMode === 'guide';
    this.views.channels.classList.toggle('live-guide-mode', guide);
    // The Guide keeps the Guide card's tint, the list the Live card's.
    this.views.channels.dataset.backdrop = guide ? 'epg' : 'live';
    const grid = $('#live-guide');
    if (guide) show(grid);
    else hide(grid);
    this.liveHeader.leave(false);
    this.liveHeader.attach(this.views.channels, this.liveMode);
  }

  private showView(name: ViewName, preserveChannelFocus = false, resumeChannelFocus = false): void {
    // Every way out of the manager (Back, color keys, a reminder)
    // ends management so concealment returns; the manager never stays stacked.
    if (name !== 'parental-controls' && this.isCurrentView('parental-controls')) {
      this.parentalControls.close();
      this.parentalPinPrompt.dismissManagement();
      ParentalControlService.endManagement();
      this.viewStack = ['settings'];
    }
    this.livePreview?.beforeViewChange(name);
    if (name !== 'channels' && this.channelList.isEditing) this.channelList.exitEditMode();
    if (name !== 'channels') this.liveDwell.cancel();
    this.placeLiveHeader(name);
    // Re-assert the persisted theme on every view transition. This reverts any
    // unsaved live preview when Settings closes (Back / section switch / Cancel)
    // while keeping a just-saved theme, since save() persists before this runs.
    applyTheme(StorageService.getTheme());
    applyOverlayStyle(StorageService.getOverlayStyle());
    applyTextSize(StorageService.getTextSize());
    applyInterfaceSize(StorageService.getInterfaceSize());
    applyAnimationMode(StorageService.getAnimationMode());
    this.player.closeSubtitleSearch(); // never let the subtitle overlay linger across a view change
    this.player.closeSubtitleOffset(); // never let the subtitle-sync overlay linger across a view change
    this.liveGuide.dismissPrompt(); // never let the catch-up prompt linger across a view change
    this.search.dismissPrompt();
    this.settings.dismissPrompt();
    this.reminderManager.dismissPrompt();
    // The launch splash is the only screen once: later loads sit under the
    // view they load for, over the video plane.
    this.views.loading.classList.remove('loading-splash');
    delete this.views.loading.dataset.backdrop;
    for (const [key, el] of Object.entries(this.views)) {
      if (key === 'loading') continue;
      if (key === name) show(el);
      else hide(el);
    }

    if (name === 'player') {
      if (this.viewStack[this.viewStack.length - 1] !== name) this.viewStack.push(name);
    } else if (name !== this.viewStack[this.viewStack.length - 1]) {
      this.viewStack = [name];
    }

    if (name !== 'home') this.home?.hidden();
    this.homeButton?.showOn(name !== 'home' && sectionForView(name) ? name : null);
    if (name === 'home' || name === 'search') this.playerReturn = name;
    else if (name !== 'player') this.playerReturn = 'channels';
    if (name !== 'search') this.searchBox?.release();

    // Focus the channel entry point on entry. No-op on first load (render runs after).
    if (name === 'channels' && this.liveMode === 'guide') {
      if (!this.liveGuide.isShown) this.liveGuide.show(this.player.getCurrentIndex());
      else this.liveGuide.render();
      if (!preserveChannelFocus) {
        if (this.guideKeys === 'grid') this.liveGuide.enter();
        else this.channelList.focusGroups();
      }
    } else if (name === 'channels' && !preserveChannelFocus) {
      this.channelList.highlightEntryPoint(resumeChannelFocus);
    }
    this.livePreview?.refresh();
    // Back in the list, the preview follows the row focus rests on, even
    // when entry put focus back on the row it already held.
    if (name === 'channels' && this.liveMode === 'list') {
      this.onLiveRowFocus(this.channelList.focusedChannel);
    }
    if (name === 'channels') this.showLiveCategoryNotices();
  }

  // Show a section's view (Live = the channels view).
  private switchSection(section: Section): void {
    if (section === 'home') {
      this.goHome();
      return;
    }
    if (section !== 'live' && this.channelList.isEditing) this.channelList.exitEditMode();
    if (section !== 'movies') this.movies.deactivate();
    if (section !== 'series') this.series.deactivate();
    if (section !== 'search') this.search.deactivate();
    if (section === 'live') {
      if (!this.livePreview.returnFromFullscreen(false)) {
        this.player.stop();
        this.showView('channels');
        this.channelList.render();
      }
      return;
    }
    this.player.stop();
    if (section === 'movies') {
      this.showView('movies');
      const account = this.activeXtreamAccount();
      if (account) {
        this.movies.open(account)
          .catch((err) => log.error(
            'Movies open failed',
            'event=xtream.view.open.failed',
            'operation=movies',
            err,
          ));
      }
      return;
    }
    if (section === 'series') {
      this.showView('series');
      const seriesAccount = this.activeXtreamAccount();
      if (seriesAccount) {
        this.series.open(seriesAccount)
          .catch((err) => log.error(
            'Series open failed',
            'event=xtream.view.open.failed',
            'operation=series',
            err,
          ));
      }
      return;
    }
    if (section === 'settings') {
      this.settings.render();
      this.showView('settings');
      return;
    }
    this.openSearch();
  }

  // An empty query box with the caret, and the recent searches under it.
  private openSearch(): void {
    this.showView('search');
    this.lastSearchQuery = '';
    this.searchBox.setQuery('');
    this.search.open(this.activeXtreamAccount())
      .catch((err) => log.error(
        'Search open failed',
        'event=xtream.view.open.failed',
        'operation=search',
        err,
      ));
    this.searchBox.focus();
  }

  // The search box's query changed; an empty box shows the recent searches.
  private handleSearchQuery(query: string): void {
    this.lastSearchQuery = query;
    this.search.scheduleQuery(query);
  }

  private refreshEpgDependentViews(): void {
    this.applyDisplayTz();
    this.channelList.render();
    this.livePreview.refresh();
    this.liveGuide.render();
    void this.search.refreshPrograms();
    this.searchPrewarm.schedule('epg');
  }

  private openReminderManager(): void {
    this.showView('reminders');
    this.reminderManager.open();
  }

  private authorizeLiveEditing(name: string, proceed: () => void): void {
    const guarded = ParentalControlService.guardsLiveEditing;
    log.info('Parental settings guard', 'event=parental.guard', 'action=live-edit',
      `guarded=${String(guarded)}`);
    if (!guarded) {
      proceed();
      return;
    }
    this.parentalPinPrompt.showVerify(t('parental.enterFor', { name }), proceed);
  }

  private authorizeSourceRemoval(id: string, proceed: () => void, turnOff = false): void {
    const guarded = ParentalControlService.guardsSourceRemoval(id);
    log.info('Parental settings guard', 'event=parental.guard',
      `action=${turnOff ? 'source-turn-off' : 'source-remove'}`, `source=${encodeURIComponent(id)}`,
      `guarded=${String(guarded)}`);
    if (!guarded) {
      proceed();
      return;
    }
    const name = StorageService.getPlaylists().find(entry => entry.id === id)?.name ?? '';
    this.parentalPinPrompt.showVerify(
      t(turnOff ? 'parental.enterToTurnOff' : 'parental.enterToRemove', { name }), proceed);
  }

  private openParentalControls(): void {
    const open = () => {
      this.showView('parental-controls');
      this.parentalControls.open();
      ParentalControlService.logState('manager-opened');
    };
    if (!ParentalControlService.configured) {
      this.parentalPinPrompt.showCreate(open);
      return;
    }
    this.parentalPinPrompt.showVerify(t('settings.parentalControls'), open);
  }

  // The section shown now, or null on the player and the Settings sub-pages.
  private currentSection(): Section | null {
    return sectionForView(this.viewStack[this.viewStack.length - 1]);
  }

  // Show Home; `focus` picks a destination to land on.
  private goHome(focus: Section | null = null): void {
    if (this.channelList.isEditing) this.channelList.exitEditMode();
    this.movies.deactivate();
    this.series.deactivate();
    this.search.deactivate();
    this.player.stop();
    const fresh = this.home.focusScope.focusKey === null;
    this.showView('home');
    this.home.render();
    if (focus || fresh) this.home.focusEntry(focus);
    else this.home.resumeFocus();
  }

  // Back once `view` has nothing of its own left to step out of: one level
  // up, Home from a section, and out of the app from Home.
  private goUp(view: ViewName): void {
    switch (backStep(view, this.playerReturn)) {
      case 'exit':
        void this.exitApp();
        return;
      case 'home':
        this.goHome(view === 'player' ? null : sectionForView(view));
        return;
      case 'channels':
        this.channelList.render();
        this.showView('channels');
        return;
      case 'search':
        this.showView('search');
        return;
      case 'settings':
        if (view === 'reminders') {
          this.showView('settings');
          this.settings.focusReminderEntry();
        } else {
          this.leaveParentalControls();
        }
        return;
    }
  }

  // A section picked on Home. The shown one keeps its place.
  private selectSection(section: Section, via: 'key' | 'pointer'): void {
    if (this.currentSection() === section) return;
    // Settings lists the guide sources and saves offsets by channel.
    if (!this.channelsLoaded
      && (section === 'live' || section === 'search' || section === 'settings')) {
      this.withChannels(() => this.selectSection(section, via));
      return;
    }
    this.switchSection(section);
    // A click leaves the pointer on Home, so the content's focus
    // waits for a key. Search keeps the keys in its own box.
    if (via === 'pointer' && section !== 'search') {
      FocusRing.defer(this.viewStack[this.viewStack.length - 1]);
    }
  }

  // Sources the next Search open will read; an open Search stores its own.
  private searchPrewarmSources(): SearchPrewarmSource[] {
    const current = this.viewStack[this.viewStack.length - 1];
    if (current === 'search') return [];
    const sources: SearchPrewarmSource[] = [];
    const playlist = PlaylistService.getChannelCacheSource()?.record;
    if (playlist) sources.push({ ...playlist });
    for (const record of EpgService.getProgrammeCacheRecords()) {
      sources.push({ store: EPG_STORE, key: record.url, timestamp: record.timestamp });
    }
    const account = this.activeXtreamAccount();
    if (account) {
      sources.push(
        { store: CATALOG_STORE, key: `${account.id}|vod_all` },
        { store: CATALOG_STORE, key: `${account.id}|series_all` },
      );
    }
    return sources;
  }

  private activeXtreamAccount(): PlaylistEntry | null {
    const accounts = StorageService.getPlaylists()
      .filter((p) => p.source === 'xtream' && p.xtream && isSourceEnabled(p));
    const selId = StorageService.getSelectedXtreamAccountId();
    return accounts.find((a) => a.id === selId) ?? accounts[0] ?? null;
  }

  // A different Xtream account was picked in an avatar dropdown (Home, the
  // parental manager): persist it; each section opens on it next time.
  private selectXtreamAccount(id: string): void {
    StorageService.setSelectedXtreamAccountId(id);
    ParentalControlService.lock('account-switched');
    const account = this.activeXtreamAccount();
    if (!account) return;
    log.info('Xtream account switched to', account.name);
    this.searchPrewarm.schedule('account');
    this.syncSources();
    if (this.isCurrentView('home')) this.home.render();
  }

  private reopenAccountSection(account: PlaylistEntry): void {
    const current = this.viewStack[this.viewStack.length - 1];
    if (current === 'movies') {
      this.movies.open(account)
        .catch((err) => log.error(
          'Movies reopen failed',
          'event=xtream.view.open.failed',
          'operation=movies_reopen',
          err,
        ));
    } else if (current === 'series') {
      this.series.open(account)
        .catch((err) => log.error(
          'Series reopen failed',
          'event=xtream.view.open.failed',
          'operation=series_reopen',
          err,
        ));
    }
    if (current === 'search') {
      this.search.open(account)
        .then(() => this.search.setQuery(this.lastSearchQuery))
        .catch((err) => log.error(
          'Search reopen failed',
          'event=xtream.view.open.failed',
          'operation=search_reopen',
          err,
        ));
    }
  }

  // Rebuild every surface that drops concealed content. Lists re-derive from the
  // filtered channels and catalogs; stored favorites/history are never touched.
  private onParentalLocksChanged(concealmentChanged: boolean): void {
    if (concealmentChanged) {
      PlaylistService.applyCustomization();
      this.player.syncCurrentIndex();
      this.search.invalidateCatalog();
    }
    const current = this.viewStack[this.viewStack.length - 1];
    if (current === 'channels') {
      this.channelList.render();
      this.liveGuide.render();
    }
    else if (current === 'settings' && concealmentChanged) this.settings.refreshCollectionCounts();
    if (current === 'search') {
      if (concealmentChanged) void this.search.refreshConcealment();
      else this.search.refreshLocks();
    }
    const account = this.activeXtreamAccount();
    if (account && (current === 'movies' || current === 'series')) {
      if (concealmentChanged) this.reopenAccountSection(account);
      else (current === 'movies' ? this.movies : this.series).refreshLocks();
    }
    this.sidebar.refresh();
    ReminderService.refreshParentalCopy();
    const session = ParentalControlService.sessionActive;
    this.home?.setParentalSession(session);
    if (current === 'home') this.home.render();
    if (concealmentChanged) this.livePreview?.refresh();
  }

  private playChannel(index: number, catchup?: CatchupInfo, scope: ChannelScope | null = null): void {
    this.player.play(index, catchup, scope, false);
  }

  private bindReminderLifecycle(): void {
    setInterval(() => this.scanReminders(), CONFIG.REMINDER_SCAN_INTERVAL);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.scanReminders();
    });
    // "Watch now" on a dev-mode reminder alert relaunches us with a channel key.
    document.addEventListener('webOSRelaunch', (e) => {
      this.handleLaunchParams((e as CustomEvent).detail);
    });
  }

  private coldLaunchParams(): unknown {
    const w = window as unknown as { PalmSystem?: { launchParams?: string } };
    return w.PalmSystem?.launchParams;
  }

  private handleLaunchParams(raw: unknown): void {
    if (!ReminderService.isReminderLaunch(raw)) return;
    if (!this.channelsLoaded) {
      this.withChannels(() => this.handleLaunchParams(raw));
      return;
    }
    const idx = ReminderService.resolveLaunchChannel(raw);
    if (idx >= 0) {
      log.info('Reminder launch — tuning channel index', idx);
      this.playChannel(idx);
      return;
    }
    const concealed = ReminderService.resolveConcealedLaunchChannel(raw);
    if (concealed) this.playConcealedReminder(concealed.key, concealed.channel);
  }

  // The PIN prompt keeps the hidden channel's name out, as the notification did.
  private playConcealedReminder(key: string, channel: Channel): void {
    log.info('Concealed reminder channel requested', 'event=parental.reminder.concealed',
      `channel=${key}`);
    ParentalControlService.authorize({ ...liveParentalRequest(channel, 'reminder'), label: '' }, () => {
      // The unlock reveals the channel, but lists rebuild only after this runs.
      PlaylistService.applyCustomization();
      const index = ReminderService.resolveChannelIndex(key);
      if (index >= 0) this.playChannel(index);
      else {
        log.warn('Unlocked reminder channel is missing', 'event=parental.reminder.missing',
          `channel=${key}`);
      }
    });
  }

  private scanReminders(): void {
    // Without the channels every reminder looks orphaned, so a due one loads
    // them first rather than letting prune drop them all.
    if (!this.channelsLoaded) {
      if (ReminderService.anyDueNow()) {
        void this.ensureChannels(true).then(() => {
          if (this.channelsLoaded) this.scanReminders();
        });
      }
      return;
    }
    ReminderService.prune();
    // Dev mode: the interactive system alert is the single notification path,
    // so skip the in-app prompt (prune still runs to clean up ended reminders).
    if (ReminderService.devMode) return;
    this.showNextReminder();
  }

  private showNextReminder(): void {
    if (this.reminderPrompt.visible) return;
    const due = ReminderService.dueNow();
    const r = due[0];
    if (!r) return;
    const concealed = ReminderService.concealedChannel(r.channelKey);
    this.reminderPrompt.show(
      truncate(r.title, CONFIG.REMINDER.TITLE_MAX),
      truncate(r.channelName, CONFIG.REMINDER.CHANNEL_MAX),
      {
      onConfirm: () => {
        ReminderService.remove(r.channelKey, r.startMs);
        const idx = ReminderService.resolveChannelIndex(r.channelKey);
        if (idx >= 0) this.playChannel(idx);
        else if (concealed) this.playConcealedReminder(r.channelKey, concealed);
        this.showNextReminder();
      },
      onCancel: () => {
        ReminderService.remove(r.channelKey, r.startMs);
        if (this.viewStack[this.viewStack.length - 1] === 'reminders') {
          this.reminderManager.open();
        }
        this.showNextReminder();
      },
    }, concealed !== null);
  }

  // The one answer to "who gets the next key": handleKey routes by the owner,
  // the key diagnostic timeline names it, and FocusRing lets only its root
  // show a ring. A "button does nothing" report is usually an unexpected
  // owner. Prompts, the search box, the sidebar, and the player's overlays push
  // themselves while shown (the player view still routes the keys of its
  // controls, track pickers, and subtitle search); below them the shown view
  // owns the keys.
  private initFocusScopes(): void {
    const current = () => this.viewStack[this.viewStack.length - 1];
    const views = new Map<ViewName, FocusScope>();
    const own: Partial<Record<ViewName, FocusScope>> = {
      home: this.home.focusScope,
      channels: this.channelList.focusScope,
      settings: this.settings.focusScope,
      'parental-controls': this.parentalControls.focusScope,
      movies: this.movies.focusScope,
      series: this.series.focusScope,
      search: this.search.focusScope,
      reminders: this.reminderManager.focusScope,
    };
    for (const name of Object.keys(this.views) as ViewName[]) {
      views.set(name, own[name]
        ?? Focus.register({ id: `view.${name}`, root: this.views[name] }));
    }
    // In the Guide the time grid owns the keys until they go to the groups.
    Focus.setBase(() => (current() === 'channels' && this.liveMode === 'guide'
      && this.guideKeys === 'grid' ? this.liveGuide.focusScope : views.get(current()) ?? null));
    Focus.install();
  }

  private handleKey(action: Action, event?: NumberEvent): void {
    const currentView = this.viewStack[this.viewStack.length - 1];
    const owner = Focus.owner();

    log.debug('Key routed', 'event=key.action', `action=${action}`,
      `view=${currentView}`, `owner=${owner?.id ?? 'none'}`,
      `number=${event ? String(event.number) : 'none'}`);

    // The digit OSD is body-mounted and outlives every view, so an abandoned
    // or committed entry must be cleared before a modal gets a chance to
    // swallow this.
    if (action === 'number_cancel') {
      hideNumberEntry();
      return;
    }
    if (action === 'number') hideNumberEntry();

    // The scope that owns the keys (by tier, then latest push) takes them first.
    if (owner?.handle(action, event)) return;

    // Direct channel entry: echo the digits while KeyHandler buffers them, in
    // the two views that act on them (the guide and prompts ignore numbers).
    if (action === 'number_input') {
      if (currentView === 'channels' || currentView === 'player' || currentView === 'home') {
        showNumberEntry(event?.digits ?? '');
      }
      return;
    }

    // The manager owns its color keys (Lock all, Clear exceptions).
    if (currentView === 'parental-controls') {
      this.parentalControls.handleAction(action);
      return;
    }

    // Global shortcuts
    // While the channel list is in edit mode the color keys belong to the editor.
    const editingChannels = currentView === 'channels' && this.channelList.isEditing;
    // Red flips Live between the list and the Guide, and opens the Guide
    // from anywhere else.
    if (action === 'red' && !editingChannels) {
      this.setLiveMode(currentView === 'channels' && this.liveMode === 'guide' ? 'list' : 'guide');
      return;
    }
    if (action === 'blue' && currentView !== 'settings' && !editingChannels) {
      this.withChannels(() => {
        this.sidebar.hide();
        this.player.stop();
        this.settings.render();
        this.showView('settings');
      });
      return;
    }
    if (action === 'green' && currentView === 'player'
        && (this.sidebar.visible || this.player.liveControlsShown())) {
      this.togglePlayingFavorite();
      return;
    }
    if (action === 'yellow' && currentView === 'player') {
      this.player.showOSD();
      return;
    }

    // Back handling
    if (action === 'back') {
      if (currentView === 'player') {
        if (this.sidebar.visible) {
          if (!this.sidebar.handleBack()) this.sidebar.hide();
        } else if (!this.player.handleBack()
            // Live's preview keeps playing what Back left; Home and Search stop it.
            && !(this.playerReturn === 'channels' && this.livePreview.returnFromFullscreen(true))) {
          this.player.handleAction('back');
        }
        return;
      }
      if (currentView === 'movies') { this.movies.handleAction('back'); return; }
      if (currentView === 'series') { this.series.handleAction('back'); return; }
      if (currentView === 'search') { this.search.handleAction('back'); return; }
      if (currentView === 'home') {
        this.home.handleAction('back');
        return;
      }
      if (currentView === 'settings') {
        if (this.settings.dismissDropdown()) return;
        this.goUp('settings');
        return;
      }
      if (currentView === 'reminders') {
        this.reminderManager.handleAction('back');
        return;
      }
      if (currentView === 'channels') {
        if (this.liveMode === 'guide' && this.guideKeys === 'grid') {
          this.liveGuide.handleAction('back');
          return;
        }
        if (this.channelList.handleBack()) return;
        this.goUp('channels');
        return;
      }
    }

    // The first key into a section the pointer entered only shows its focus:
    // it must not act on an item nobody has seen yet.
    if (FocusRing.revealForKey(action)) return;

    // Delegate to active view
    switch (currentView) {
      case 'home':
        this.home.handleAction(action, event);
        break;
      case 'channels': {
        if (this.livePreview.handleAction(action)) break;
        if (this.liveMode === 'guide' && this.guideKeys === 'grid') {
          this.liveGuide.handleAction(action);
          break;
        }
        const group = this.channelList.group;
        const moved = this.channelList.handleAction(action, event);
        if (this.liveMode === 'guide') {
          if (this.channelList.group !== group) this.liveGuide.groupChanged();
          if (action === 'right' && !moved) {
            this.focusGuideGrid();
            break;
          }
        }
        // Up off the top of the groups or the list: the header.
        if (action === 'up' && !moved && !this.channelList.isEditing) this.liveHeader.enter();
        break;
      }
      case 'movies':
        this.movies.handleAction(action);
        break;
      case 'series':
        this.series.handleAction(action);
        break;
      case 'search':
        this.search.handleAction(action);
        break;
      case 'player':
        // VOD has no channel list: the player takes every key.
        if (this.player.isVod()) {
          this.player.handleAction(action, event);
          break;
        }
        if (this.sidebar.visible && (
          action === 'left' || action === 'right' ||
          action === 'up' || action === 'down' ||
          action === 'channel_up' || action === 'channel_down' ||
          action === 'select'
        )) {
          this.sidebar.handleAction(action);
        } else if (action === 'left' && !this.player.claimsLeft()) {
          // Left opens the channel list unless the controls or a seekable
          // stream's skip take it.
          this.sidebar.show();
        } else {
          this.player.handleAction(action, event);
        }
        break;
      case 'settings':
        this.settings.handleAction(action);
        break;
      case 'reminders':
        this.reminderManager.handleAction(action);
        break;
    }
  }

  private initSidebarTrigger(): void {
    document.addEventListener('pointermove', (e: PointerEvent) => {
      const currentView = this.viewStack[this.viewStack.length - 1];
      if (currentView !== 'player') return;

      const osd = $('#player-osd', this.views.player);
      const osdRect = osd?.getBoundingClientRect();
      const overOsd = !!osd && !osd.classList.contains('hidden') && !!osdRect
        && e.clientY >= osdRect.top;

      // VOD (movies/series) has no channels — only the OSD (title, seek bar,
      // and controls) is pointer-revealable; suppress the channel sidebar.
      const vod = this.player.isVod();
      // A modal over the player, such as the subtitle sync adjuster, keeps
      // the edge panels shut.
      const modal = !!Focus.owner()?.modal;

      // Protect the full-width area beside and below the OSD too: its edge
      // controls sit next to margins where an imprecise cursor can open a panel.
      const overTabs = !!(e.target as HTMLElement).closest('.player-sidebar .sidebar-tabs');
      if (!overOsd && !vod && !modal && e.clientX < 80 && !this.player.pickerVisible()) {
        this.sidebar.show();
        this.sidebar.handlePointerMove(e.clientX, false, overTabs);
      } else if (this.sidebar.visible) {
        const overSidebar = !!(e.target as HTMLElement).closest('.player-sidebar');
        const delayingDismiss = this.sidebar.handlePointerMove(e.clientX, overSidebar, overTabs);
        if (!delayingDismiss && !overSidebar
            && e.clientX > this.sidebar.pointerDismissX && !this.sidebar.keyboardOn) {
          // Never dismiss while the keyboard is on — the pointer naturally
          // leaves the sidebar on its way to the on-screen keyboard.
          this.sidebar.hide();
        }
      }

      // Bottom OSD info bar
      if (e.clientY > 900 && !this.sidebar.visible && !this.player.pickerVisible()) {
        this.player.showOSD();
      }
    });
  }

  private togglePlayingFavorite(): void {
    const ch = this.player.getCurrentChannel();
    if (!ch) return;
    this.toggleChannelFavorite(ch);
  }

  private toggleChannelFavorite(ch: Channel): void {
    const key = channelKey(ch);
    StorageService.toggleFavorite(key);
    showToast(StorageService.getFavorites().includes(key)
      ? t('channel.favoriteAdded', { name: ch.name })
      : t('channel.favoriteRemoved', { name: ch.name }));
    this.channelList.render();
    this.sidebar.refresh();
  }


  private async onSettingsSaved(action: SaveAction): Promise<void> {
    if (action === 'edit-channels') {
      this.showView('channels');
      this.channelList.render();
      this.channelList.enterEditMode('builtin:all');
      return;
    }
    if (action === 'reset') {
      await resetAppData();
      log.info(
        'App reset completed',
        'event=persistence.reset.completed',
        'operation=clear',
      );
      location.reload();
      return;
    }
    if (action !== 'cancel') {
      const locale = resolveLocale(StorageService.getLocalePreference());
      if (locale !== getLocale()) {
        setLocale(locale);
        this.syncSources();
        this.homeButton.refreshLabel();
        ReminderService.reschedulePending();
      }
      // Republish on 'apply' too: subtitle credentials and other display-only
      // settings never reach the phone page otherwise. Advisory, so it never
      // holds up closing Settings.
      void SetupClient.publishState();
    }
    if (action === 'reload') {
      this.search.invalidateCatalog();
      await Promise.all([clearCachedPlaylist(), clearCachedCatalog()]);
      this.showView('channels');
      // 'launch' lands on the start screen (Home), as Settings was opened from it.
      await this.loadData(true, 'launch');
      return;
    }
    // 'apply': only display settings changed — re-apply + re-render, no re-fetch.
    if (action === 'apply') {
      this.search.invalidateCatalog();
      this.applyDisplayTz();
      this.scheduleEpgRefresh();
      this.schedulePlaylistRefresh();
    }
    this.channelList.render();
    if (StorageService.getStartOnLive()) this.showView('channels');
    else this.goHome();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  installGlobalErrorHandlers();
  logEnvironment(CONFIG.VERSION);
  const app = new App();
  app.init().catch(err => log.error('App init failed:', err));
});
