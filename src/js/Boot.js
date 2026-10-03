// Boot.js
//
// Replaces the inline <script> block that header.php used to emit, plus the
// server-side settings handling from modules/config.php and the header.
//
// Three jobs:
//
//   1. Define the globals the rest of the app reads: host, webRoot,
//      siteVersion, settings, get.
//   2. Move settings from a PHP-set cookie to localStorage, since there is no
//      server to set cookies for us anymore.
//   3. Derive `get` from the URL query string via Router, matching what PHP
//      used to hand us as $_GET.
//
// This file must be synchronous and must run before any page script.

(function(){
	// Where the site is mounted. "/" means "serve this directory as the web
	// root", which is what `python -m http.server` does when pointed at src/.
	// Absolute paths keep every link working regardless of which subdirectory
	// the current page lives in (e.g. /train/index.html).

	var WEB_ROOT = "/";
	var SITE_VERSION = "1.40.2.3";

	// Host used to build share links. The original app hardcoded
	// "http://" + $_SERVER['HTTP_HOST']; on a static server the browser already
	// knows the origin, so use that (and stay on https when served over https).

	var host = window.location.origin + WEB_ROOT;

	window.webRoot = WEB_ROOT;
	window.host = host;
	window.siteVersion = SITE_VERSION;

	// ---- Settings ---------------------------------------------------------
	//
	// Previously read from the "settings" cookie that data/settingsCookie.php
	// wrote. localStorage is simpler, larger, and available over file:// too.
	// The default-filling logic is carried over verbatim.

	var STORAGE_KEY = "pvpoke.settings";

	var DEFAULT_SETTINGS = {
		defaultIVs: "gamemaster",
		animateTimeline: 1,
		theme: "default",
		gamemaster: "gamemaster",
		pokeboxId: 0,
		ads: 1,
		xls: 1,
		rankingDetails: "one-page",
		hardMovesetLinks: 0,
		colorblindMode: 0,
		performanceMode: 0
	};

	function readSettings(){
		var stored = null;

		try{
			stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
		} catch(e){
			stored = null;
		}

		if(! stored || typeof stored !== "object"){
			// Fall back to the old cookie format so upgrading users keep their
			// preferences, then migrate it.
			var cookie = getCookie("settings");

			if(cookie){
				try{
					stored = JSON.parse(cookie);
				} catch(e2){
					stored = null;
				}
			}
		}

		var out = {};

		for(var key in DEFAULT_SETTINGS){
			if(DEFAULT_SETTINGS.hasOwnProperty(key)){
				out[key] = DEFAULT_SETTINGS[key];
			}
		}

		if(stored && typeof stored === "object"){
			for(var k in stored){
				if(stored.hasOwnProperty(k) && stored[k] !== undefined && stored[k] !== null){
					out[k] = stored[k];
				}
			}
		}

		// Fill in missing values and migrate deprecated gamemaster names.
		// (Ported from header.php.)

		if(! out.matrixDirection){
			out.matrixDirection = "row";
		}

		if(! out.gamemaster){
			out.gamemaster = "gamemaster";
		} else if(out.gamemaster == "gamemaster-paldea" || out.gamemaster == "gamemaster-mega"){
			out.gamemaster = "gamemaster";
		}

		if(out.pokeboxId === undefined){
			out.pokeboxId = false;
		}

		if(out.pokeboxLastDateTime === undefined){
			out.pokeboxLastDateTime = 0;
		}

		if(out.ads === undefined){
			out.ads = 1;
		}

		if(out.xls === undefined){
			out.xls = 1;
		}

		if(! out.rankingDetails){
			out.rankingDetails = "one-page";
		}

		if(out.hardMovesetLinks === undefined){
			out.hardMovesetLinks = 0;
		}

		if(out.colorblindMode === undefined){
			out.colorblindMode = 0;
		}

		if(out.performanceMode === undefined){
			out.performanceMode = 0;
		}

		if(! out.theme){
			out.theme = "default";
		}

		// Booleans were emitted by PHP as 0/1 and by hand-edited localStorage
		// as true/false. Normalize to numbers so the existing `== 1` and
		// `== 0` comparisons keep working either way.

		var numeric = ["animateTimeline", "ads", "xls", "hardMovesetLinks", "colorblindMode", "performanceMode"];

		for(var i = 0; i < numeric.length; i++){
			out[numeric[i]] = (out[numeric[i]] === true || out[numeric[i]] === 1 || out[numeric[i]] === "1") ? 1 : 0;
		}

		out.pokeboxId = parseInt(out.pokeboxId) || 0;
		out.pokeboxLastDateTime = parseInt(out.pokeboxLastDateTime) || 0;

		return out;
	}

	function getCookie(name){
		var match = document.cookie.match(new RegExp("(?:^|; )" + name.replace(/([.$?*|{}()\[\]\\\/+^])/g, "\\$1") + "=([^;]*)"));

		return match ? decodeURIComponent(match[1]) : null;
	}

	window.readSettings = readSettings;

	window.saveSettings = function(obj){
		try{
			window.localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
			return true;
		} catch(e){
			console.error("Could not persist settings:", e);
			return false;
		}
	};

	window.settings = readSettings();

	// ---- Apply appearance settings ----------------------------------------
	//
	// header.php used to emit a <link> for the theme stylesheet and a class on
	// <body> based on the cookie. Both are cheap to do at runtime and avoid
	// duplicating that logic into every page.

	function applyAppearance(){
		if(window.settings.colorblindMode == 1){
			document.body.classList.add("colorblind");
		}

		if(window.settings.theme && window.settings.theme != "default"){
			var existing = document.getElementById("theme-stylesheet");

			if(! existing){
				existing = document.createElement("link");
				existing.id = "theme-stylesheet";
				existing.rel = "stylesheet";
				existing.type = "text/css";
				document.head.appendChild(existing);
			}

			existing.href = WEB_ROOT + "css/themes/" + window.settings.theme + ".css?v=30";
		}
	}

	if(document.body){
		applyAppearance();
	} else{
		document.addEventListener("DOMContentLoaded", applyAppearance);
	}

	// ---- URL parameters ----------------------------------------------------
	//
	// PHP emitted `var get = false` when $_GET was empty and `var get = {...}`
	// otherwise. Reproduce that exactly: several call sites branch on
	// `if(! get)` to decide whether the first render came from a shared link.

	function readGet(){
		var params = Router.parseQuery(window.location.search);

		// Also accept a pretty URL in the hash, so links copied from pvpoke.com
		// still work when pasted into the address bar of the static build.
		var hash = window.location.hash;

		if(hash && hash.length > 1 && hash.indexOf("?") === -1){
			var decoded = Router.decode(hash.substring(1));

			for(var key in decoded){
				if(decoded.hasOwnProperty(key)){
					params[key] = decoded[key];
				}
			}
		}

		if(Object.keys(params).length === 0){
			return false;
		}

		return params;
	}

	window.get = readGet();

	// ---- Legacy cookie cleanup ---------------------------------------------
	//
	// footer.php ran a one-time migration of `custom_group*` cookies into
	// localStorage. Do the same on first load.

	window.migrateCustomGroups = function(){
		var groups = document.cookie.match(/custom_group[^=]*=[^;]*/g);

		if(! groups){
			return;
		}

		for(var i = 0; i < groups.length; i++){
			var eq = groups[i].indexOf("=");
			var value = groups[i].substring(eq + 1);

			try{
				var parsed = JSON.parse(decodeURIComponent(value));

				if(parsed && parsed.name && parsed.data){
					window.localStorage.setItem(parsed.name, parsed.data);
				}
			} catch(e){
				// Not one of ours; ignore.
			}
		}
	};
})();
