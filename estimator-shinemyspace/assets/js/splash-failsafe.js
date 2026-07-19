/**
 * splash-failsafe.js — last-resort removal of the first-paint loading screen.
 *
 * The app normally removes #splash from app.js (hideSplash) once boot() decides
 * which screen to show. That only runs if the ES-module app.js loads AND boots
 * without throwing. If a stale/broken cached file breaks the module graph, boot
 * never runs and the splash would hang forever ("stuck on Loading…").
 *
 * This is a CLASSIC script (not type="module"), so it executes even when the
 * module app.js never loads. If the splash is still on screen after a generous
 * timeout, it fades it out — revealing whatever the page settled on underneath
 * (the app for a returning user, or the login gate by default). Worst case
 * becomes "login page shows, reload once" instead of an infinite spinner.
 *
 * The timeout is deliberately long (well past a normal ~2-3s boot, even on slow
 * mobile) so it only fires on genuine failure, never on a slow-but-working load.
 */
(function () {
  var TIMEOUT_MS = 10000;
  window.setTimeout(function () {
    var splash = document.getElementById("splash");
    if (!splash) return; // app already removed it — nothing to do
    console.warn("[splash-failsafe] app did not start in time; revealing the page.");
    splash.classList.add("is-hidden");
    window.setTimeout(function () {
      if (splash && splash.parentNode) splash.parentNode.removeChild(splash);
    }, 500);
  }, TIMEOUT_MS);
})();
