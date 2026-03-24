/**
 * When the HTML is served from the same Render Web Service as FastAPI, API base is "".
 * If you use a separate Static Site for HTML, set Render env RIDEWISE_PUBLIC_API_URL on the API
 * and load <script src="https://YOUR-API.onrender.com/ridewise-env.js"></script> before this file.
 */
(function () {
  function normalizeBase(b) {
    if (b == null || b === "") return "";
    return String(b).replace(/\/$/, "");
  }

  window.ridewiseUrl = function (path) {
    var p = path.charAt(0) === "/" ? path : "/" + path;
    var base = normalizeBase(
      typeof window.__RIDEWISE_API_BASE__ === "string" ? window.__RIDEWISE_API_BASE__ : ""
    );
    return base + p;
  };
})();
