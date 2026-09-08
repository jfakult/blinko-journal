/**
 * journal-declutter
 *
 * A CSS-only Blinko plugin that hides UI surfaces irrelevant to a single-user
 * personal voice journal deployment (see docs/workstreams/06-ui-declutter.md
 * in the main repo for the full rationale and the list of what's hidden).
 *
 * This plugin does nothing at runtime beyond registering itself with the
 * Blinko plugin host. All of the actual decluttering is done by style.css,
 * which the Blinko plugin loader (app/src/store/plugin/pluginManagerStore.ts)
 * auto-discovers and injects as a <style> tag for every *.css file found
 * anywhere inside this plugin's installed directory
 * (.blinko/plugins/journal-declutter/) — no explicit "load my CSS" call is
 * required from this file.
 *
 * Intentionally has NO access to window.Blinko.api and makes no network
 * calls — it only ships a stylesheet.
 */

// Minimal structural (duck-typed) copy of Blinko's BasePlugin contract.
// Plugins are built and shipped as standalone bundles, so we don't import
// the host app's internal `@/store/plugin` module — we just match its shape:
// https://docs.blinko.space/en/plugins/get-started.md
interface I18nString {
  default: string;
  [locale: string]: string | undefined;
}

interface BlinkoPlugin {
  name?: string;
  author?: string;
  url?: string;
  version?: string;
  minAppVersion?: string;
  displayName?: I18nString;
  description?: I18nString;
  withSettingPanel?: boolean;
  init(): void;
  destroy(): void;
}

export default class JournalDeclutterPlugin implements BlinkoPlugin {
  name = 'journal-declutter';
  author = 'jfakult15';
  url = 'https://github.com/jfakult/blinko-journal';
  version = '1.0.0';
  displayName: I18nString = { default: 'Journal Declutter' };
  description: I18nString = {
    default: 'Hides nav items and settings irrelevant to a single-user personal journal (CSS-only).',
  };
  withSettingPanel = false;

  init() {
    // Nothing to do — style.css (auto-loaded by the plugin host) does all the work.
    // Left as a visible console line only to make "is this plugin actually loaded"
    // easy to confirm from devtools when installing/debugging on the real server.
    console.log('[journal-declutter] loaded — see style.css for what it hides');
  }

  destroy() {
    // No listeners, no DOM nodes created outside of what the host itself
    // manages (the <style> tag lifecycle is owned by pluginManagerStore),
    // so there is nothing for us to clean up here.
  }
}
