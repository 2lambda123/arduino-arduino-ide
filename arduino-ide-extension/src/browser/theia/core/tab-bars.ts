import { TabBar } from '@theia/core/shared/@phosphor/widgets';
import { Saveable } from '@theia/core/lib/browser/saveable';
import { TabBarRenderer as TheiaTabBarRenderer } from '@theia/core/lib/browser/shell/tab-bars';

export class TabBarRenderer extends TheiaTabBarRenderer {
  override createTabClass(data: TabBar.IRenderData<any>): string {
    let className = super.createTabClass(data);
    if (!data.title.closable && Saveable.isDirty(data.title.owner)) {
      className += ' p-mod-closable';
    }
    return className;
  }

  protected override handleContextMenuEvent = (): void => {
    // NOOP
    // Context menus are empty, so they have been removed
  };
}
