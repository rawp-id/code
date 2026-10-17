import { icons } from "./icons";

export interface Layout {
  root: HTMLElement;
  activityBar: HTMLElement;
  sidebar: HTMLElement;
  sideTitle: HTMLElement;
  sideBody: HTMLElement;
  tabs: HTMLElement;
  editorHost: HTMLElement;
  panel: HTMLElement;
  panelTabs: HTMLElement;
  terminalHost: HTMLElement;
  outputHost: HTMLElement;
}

export function createLayout(root: HTMLElement): Layout {
  root.innerHTML = `
    <div class="layout">
      <div class="activitybar" data-activity>
        <button data-view="files" class="active" title="Explorer">${icons.explorer}</button>
        <button data-view="extensions" title="Extensions">${icons.extensions}</button>
      </div>
      <div class="main">
        <div class="sidebar" data-sidebar>
          <div class="sidebar-title" data-side-title>Explorer</div>
          <div class="sidebar-body" data-side-body></div>
        </div>
        <div class="center">
          <div class="tabs" data-tabs></div>
          <div class="editor-host" data-editor></div>
          <div class="panel hidden" data-panel>
            <div class="panel-head" data-panel-tabs>
              <span class="panel-tab active" data-panel-tab="terminal">Terminal</span>
              <span class="panel-tab" data-panel-tab="output">Output</span>
              <span class="spacer"></span>
              <button class="close" data-panel-close title="Close panel">${icons.close}</button>
            </div>
            <div class="panel-body" data-panel-body="terminal">
              <div class="terminal-host" data-terminal></div>
            </div>
            <div class="panel-body hidden" data-panel-body="output">
              <div class="output-host" data-output></div>
            </div>
          </div>
        </div>
      </div>
      <div class="toasts" data-toasts></div>
    </div>
  `;

  const pick = <T extends HTMLElement = HTMLElement>(selector: string): T => {
    const element = root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing element: ${selector}`);
    return element;
  };

  return {
    root,
    activityBar: pick("[data-activity]"),
    sidebar: pick("[data-sidebar]"),
    sideTitle: pick("[data-side-title]"),
    sideBody: pick("[data-side-body]"),
    tabs: pick("[data-tabs]"),
    editorHost: pick("[data-editor]"),
    panel: pick("[data-panel]"),
    panelTabs: pick("[data-panel-tabs]"),
    terminalHost: pick("[data-terminal]"),
    outputHost: pick("[data-output]"),
  };
}
