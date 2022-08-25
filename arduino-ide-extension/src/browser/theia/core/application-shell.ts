import { injectable, inject } from '@theia/core/shared/inversify';
import { EditorWidget } from '@theia/editor/lib/browser';
import { MessageService } from '@theia/core/lib/common/message-service';
import { OutputWidget } from '@theia/output/lib/browser/output-widget';
import {
  ConnectionStatusService,
  ConnectionStatus,
} from '@theia/core/lib/browser/connection-status-service';
import {
  ApplicationShell as TheiaApplicationShell,
  DockPanel,
  DockPanelRenderer as TheiaDockPanelRenderer,
  Panel,
  TabBar,
  Widget,
  SHELL_TABBAR_CONTEXT_MENU,
  SaveOptions,
} from '@theia/core/lib/browser';
import { Sketch } from '../../../common/protocol';
import {
  CurrentSketch,
  SketchesServiceClientImpl,
} from '../../../common/protocol/sketches-service-client-impl';
import { nls } from '@theia/core/lib/common';
import URI from '@theia/core/lib/common/uri';
import { ToolbarAwareTabBar } from './tab-bars';

@injectable()
export class ApplicationShell extends TheiaApplicationShell {
  @inject(MessageService)
  private readonly messageService: MessageService;

  @inject(SketchesServiceClientImpl)
  private readonly sketchesServiceClient: SketchesServiceClientImpl;

  @inject(ConnectionStatusService)
  private readonly connectionStatusService: ConnectionStatusService;

  protected override track(widget: Widget): void {
    super.track(widget);
    if (widget instanceof OutputWidget) {
      widget.title.closable = false; // TODO: https://arduino.slack.com/archives/C01698YT7S4/p1598011990133700
    }
    if (widget instanceof EditorWidget) {
      // Make the editor un-closeable asynchronously.
      this.sketchesServiceClient.currentSketch().then((sketch) => {
        if (CurrentSketch.isValid(sketch)) {
          if (!this.isSketchFile(widget.editor.uri, sketch.uri)) {
            return;
          }
          if (Sketch.isInSketch(widget.editor.uri, sketch)) {
            widget.title.closable = false;
          }
        }
      });
    }
  }

  private isSketchFile(uri: URI, sketchUriString: string): boolean {
    const sketchUri = new URI(sketchUriString);
    if (uri.parent.isEqual(sketchUri)) {
      return true;
    }
    return false;
  }

  override async addWidget(
    widget: Widget,
    options: Readonly<TheiaApplicationShell.WidgetOptions> = {}
  ): Promise<void> {
    // By default, Theia open a widget **next** to the currently active in the target area.
    // Instead of this logic, we want to open the new widget after the last of the target area.
    if (!widget.id) {
      console.error(
        'Widgets added to the application shell must have a unique id property.'
      );
      return;
    }
    let ref: Widget | undefined = options.ref;
    const area: TheiaApplicationShell.Area = options.area || 'main';
    if (!ref && (area === 'main' || area === 'bottom')) {
      const tabBar = this.getTabBarFor(area);
      if (tabBar) {
        const last = tabBar.titles[tabBar.titles.length - 1];
        if (last) {
          ref = last.owner;
        }
      }
    }
    return super.addWidget(widget, { ...options, ref });
  }

  override handleEvent(): boolean {
    // NOOP, dragging has been disabled
    return false;
  }

  // Avoid hiding top panel as we use it for arduino toolbar
  protected override createTopPanel(): Panel {
    const topPanel = super.createTopPanel();
    topPanel.show();
    return topPanel;
  }

  override async saveAll(options?: SaveOptions): Promise<void> {
    if (
      this.connectionStatusService.currentStatus === ConnectionStatus.OFFLINE
    ) {
      this.messageService.error(
        nls.localize(
          'theia/core/couldNotSave',
          'Could not save the sketch. Please copy your unsaved work into your favorite text editor, and restart the IDE.'
        )
      );
      return; // Theia does not reject on failed save: https://github.com/eclipse-theia/theia/pull/8803
    }
    return super.saveAll(options);
  }
}

export class DockPanelRenderer extends TheiaDockPanelRenderer {
  override createTabBar(): TabBar<Widget> {
    const renderer = this.tabBarRendererFactory();
    // `ToolbarAwareTabBar` is from IDE2 and not from Theia. Check the imports.
    const tabBar = new ToolbarAwareTabBar(
      this.tabBarToolbarRegistry,
      this.tabBarToolbarFactory,
      this.breadcrumbsRendererFactory,
      {
        renderer,
        // Scroll bar options
        handlers: ['drag-thumb', 'keyboard', 'wheel', 'touch'],
        useBothWheelAxes: true,
        scrollXMarginOffset: 4,
        suppressScrollY: true,
      }
    );
    this.tabBarClasses.forEach((c) => tabBar.addClass(c));
    renderer.tabBar = tabBar;
    tabBar.disposed.connect(() => renderer.dispose());
    renderer.contextMenuPath = SHELL_TABBAR_CONTEXT_MENU;
    tabBar.currentChanged.connect(this.onCurrentTabChanged, this);
    return tabBar;
  }
}

const originalHandleEvent = DockPanel.prototype.handleEvent;

DockPanel.prototype.handleEvent = function (event) {
  switch (event.type) {
    case 'p-dragenter':
    case 'p-dragleave':
    case 'p-dragover':
    case 'p-drop':
      return;
  }
  originalHandleEvent.bind(this)(event);
};
