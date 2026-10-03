// Router.js
//
// Replaces the Apache mod_rewrite rules that used to live in src/.htaccess.
//
// The original site used pretty URLs like:
//
//     /battle/multi/2500/ultra/lucario/11/vinylstrikes-braviary/2-1/
//     /rankings/all/2500/overall/lucario/
//
// and rewrote them into a query string that PHP exposed to JS as `get`:
//
//     battle.php?mode=multi&cp=2500&cup=ultra&p1=lucario&s=11&m1=...&cms=2-1
//
// A plain static file server cannot do that rewriting, so the rewrite now
// happens here in JavaScript instead:
//
//     Router.decode("battle/multi/2500/ultra/lucario/11/moves/2-1/")
//         -> {mode:"multi", cp:"2500", cup:"ultra", p1:"lucario", s:"11", cms:"2-1"}
//
//     Router.url("battle/multi/2500/ultra/lucario/11/moves/2-1/")
//         -> "/battle.html?mode=multi&cp=2500&cup=ultra&p1=lucario&s=11&cms=2-1"
//
// `decode` mirrors the .htaccess rules one-for-one (same order, same capture
// groups, same parameter names), so the rest of the app is unchanged: it still
// reads the same `get` keys and still generates the same pretty path strings.

var Router = (function(){
	// Maps the first path segment of a pretty URL to the static file that
	// serves it. Anything not listed here falls through to the generic
	// "segments become positional params" behavior below.

	var PAGE_FILES = {
		"battle":             "battle.html",
		"rankings":           "rankings.html",
		"team-builder":       "team-builder.html",
		"attack-cmp-chart":   "attack-cmp-chart.html",
		"custom-rankings":    "custom-rankings.html",
		"moves":              "moves.html",
		"settings":           "settings.html",
		"contact":            "contact.html",
		"privacy":            "privacy.html",
		"ranker":             "ranker.html",
		"rankersandbox":      "rankersandbox.html",
		"articles":           "articles/index.html",
		"train":              "train/index.html",
		"gm-editor":          "gm-editor/index.html",
		"tera":               "tera/index.html"
	};

	// Ordered rewrite rules. These are transcriptions of the .htaccess
	// RewriteRules, most specific first. Each entry is:
	//
	//     [ pattern, { paramName: captureGroupIndex } ]
	//
	// The first pattern that matches wins, exactly like mod_rewrite.

	var RULES = [
		// ---- battle/multi -------------------------------------------------
		[/^battle\/multi\/([\d-]+)\/([a-zA-Z0-9-]+)\/([a-zA-Z_\d.-]+)\/([\d-]+)\/([\da-zA-Z_-]+)\/([a-z\d-]+)\/(\d+)\/(\d+)\/([a-zA-Z_]+)/,
			{mode:"multi", cp:1, cup:2, p1:3, s:4, m1:5, cms:6, h:7, e:8, g1:9}],
		[/^battle\/multi\/([\d-]+)\/([a-zA-Z0-9-]+)\/([a-zA-Z_\d.-]+)\/([\d-]+)\/([\da-zA-Z_-]+)\/([a-z\d-]+)\/(\d+)\/(\d+)/,
			{mode:"multi", cp:1, cup:2, p1:3, s:4, m1:5, cms:6, h:7, e:8}],
		[/^battle\/multi\/([\d-]+)\/([a-zA-Z0-9-]+)\/([a-zA-Z_\d.-]+)\/([\d-]+)\/([\da-zA-Z_-]+)\/([a-z\d-]+)\/([a-zA-Z_]+)/,
			{mode:"multi", cp:1, cup:2, p1:3, s:4, m1:5, cms:6, g1:7}],
		[/^battle\/multi\/([\d-]+)\/([a-zA-Z0-9-]+)\/([a-zA-Z_\d.-]+)\/([\d-]+)\/([\da-zA-Z_-]+)\/([a-z\d-]+)/,
			{mode:"multi", cp:1, cup:2, p1:3, s:4, m1:5, cms:6}],
		[/^battle\/multi\/([\d-]+)\/([a-zA-Z0-9-]+)\/([a-zA-Z_\d.-]+)\/([\d-]+)\/([\da-zA-Z_-]+)/,
			{mode:"multi", cp:1, cup:2, p1:3, s:4, m1:5}],
		[/^battle\/multi/, {mode:"multi"}],

		// ---- battle/matrix ------------------------------------------------
		[/^battle\/matrix\/([\d-]+)\/([a-zA-Z_\-0-9,.]+)\/([a-zA-Z_\-0-9,.]+)\/([\d-]+)/,
			{mode:"matrix", cp:1, matrix1:2, matrix2:3, s:4}],
		[/^battle\/matrix\/([\d-]+)\/([a-zA-Z_\-0-9,.]+)\/([a-zA-Z_\-0-9,.]+)/,
			{mode:"matrix", cp:1, matrix1:2, matrix2:3}],
		[/^battle\/matrix/, {mode:"matrix"}],

		// ---- battle/sandbox -----------------------------------------------
		[/^battle\/sandbox\/(\d+)\/([a-zA-Z_\d.-]+)\/([a-zA-Z_\d.-]+)\/(\d+)\/([\da-zA-Z_-]+)\/([\da-zA-Z_-]+)\/(\d+)\/(\d+)\/([\d.-]+)/,
			{cp:1, p1:2, p2:3, s:4, m1:5, m2:6, h:7, e:8, sandbox:0, a:9}],
		[/^battle\/sandbox\/(\d+)\/([a-zA-Z_\d.-]+)\/([a-zA-Z_\d.-]+)\/(\d+)\/([\da-zA-Z_-]+)\/([\da-zA-Z_-]+)\/([\d.-]+)/,
			{cp:1, p1:2, p2:3, s:4, m1:5, m2:6, h:7, e:8, sandbox:0, a:9}],

		// ---- battle (single) ----------------------------------------------
		[/^battle\/([\d-]+)\/([a-zA-Z_\d.-]+)\/([a-zA-Z_\d.-]+)\/(\d+)\/([\da-zA-Z_-]+)\/([\da-zA-Z_-]+)\/(\d+)\/(\d+)/,
			{cp:1, p1:2, p2:3, s:4, m1:5, m2:6, h:7, e:8}],
		[/^battle\/([\d-]+)\/([a-zA-Z_\d.-]+)\/([a-zA-Z_\d.-]+)\/(\d+)\/([\da-zA-Z_-]+)\/([\da-zA-Z_-]+)/,
			{cp:1, p1:2, p2:3, s:4, m1:5, m2:6}],
		[/^battle\/([\d-]+)\/([a-zA-Z_\d.-]+)\/([a-zA-Z_\d.-]+)\/(\d+)/,
			{cp:1, p1:2, p2:3, s:4}],
		[/^battle/, {}],

		// ---- rankings ------------------------------------------------------
		[/^rankings\/([a-zA-Z0-9-]+)\/(\d+)\/([a-zA-Z]+)\/([a-zA-Z_]+)/,
			{cup:1, cp:2, cat:3, p:4}],
		[/^rankings\/(\d+)\/([a-zA-Z0-9-]+)\/([a-zA-Z_]+)/,
			{cp:1, cat:2, p:3}],
		[/^rankings\/([a-zA-Z0-9-]+)\/(\d+)\/([a-zA-Z]+)/,
			{cup:1, cp:2, cat:3}],
		[/^rankings\/(\d+)\/([a-zA-Z0-9-]+)/, {cp:1, cat:2}],
		[/^rankings\/(\d+)/, {cp:1}],
		[/^rankings/, {}],

		// ---- team-builder --------------------------------------------------
		[/^team-builder\/([a-zA-Z0-9-]+)\/([\d-]+)\/([a-zA-Z_]+)\/([a-zA-Z_]+)\/([a-zA-Z_]+)\/([\da-zA-Z_-]+)\/([\da-zA-Z_-]+)\/([\da-zA-Z_-]+)/,
			{cup:1, cp:2, p1:3, p2:4, p3:5, m1:6, m2:7, m3:8}],
		[/^team-builder\/([a-zA-Z0-9-]+)\/([\d-]+)\/([a-zA-Z_]+)\/([a-zA-Z_]+)\/([a-zA-Z_]+)\/([\da-zA-Z_-]+)\/([\da-zA-Z_-]+)/,
			{cup:1, cp:2, p1:3, p2:4, p3:5, m1:6, m2:7}],
		[/^team-builder\/([a-zA-Z0-9-]+)\/([\d-]+)\/([a-zA-Z_]+)\/([\da-zA-Z_-]+)/,
			{cup:1, cp:2, p1:3, m1:4}],
		[/^team-builder\/([a-zA-Z0-9-]+)\/([\d-]+)\/([a-zA-Z_\-0-9,.]+)/,
			{cup:1, cp:2, t:3}],
		[/^team-builder/, {}],

		// ---- train ---------------------------------------------------------
		[/^train\/analysis\/([a-zA-Z0-9-]+)\/(\d+)/, {cup:1, cp:2}],
		[/^train\/analysis/, {}],
		[/^train\/editor/, {}],
		[/^train/, {}],

		// ---- attack CMP chart ----------------------------------------------
		[/^attack-cmp-chart\/([a-zA-Z0-9-]+)\/(\d+)\/([a-zA-Z_]+)/, {cup:1, cp:2, p:3}],
		[/^attack-cmp-chart\/([a-zA-Z0-9-]+)\/(\d+)/, {cup:1, cp:2}],
		[/^attack-cmp-chart/, {}],

		// ---- gamemaster editor ---------------------------------------------
		[/^gm-editor\/pokemon\/([a-zA-Z0-9_]+)/, {p:1}],
		[/^gm-editor\/pokemon/, {c:"pokemon"}],
		[/^gm-editor\/moves\/([a-zA-Z0-9_]+)/, {m:1}],
		[/^gm-editor\/moves/, {c:"moves"}],
		[/^gm-editor/, {}],

		// ---- tera raid counters ---------------------------------------------
		[/^tera\/([\da-zA-Z_-]+)\/([\da-zA-Z_-]+)\/([\da-zA-Z_-]+)\/([\da-zA-Z_-]+)/, {p:1, t:2, a:3, tr:4}],
		[/^tera\/([\da-zA-Z_-]+)\/([\da-zA-Z_-]+)\/([\da-zA-Z_-]+)/, {p:1, t:2, a:3}],
		[/^tera\/([\da-zA-Z_-]+)\/([\da-zA-Z_-]+)/, {p:1, t:2}],
		[/^tera\/([\da-zA-Z_-]+)/, {p:1}],
		[/^tera/, {}],

		// ---- moves ----------------------------------------------------------
		[/^moves\/([a-zA-Z_]+)/, {mode:1}],
		[/^moves/, {}],

		// ---- articles --------------------------------------------------------
		[/^articles\/([^/]+)/, {id:1}],

		// ---- flat pages -------------------------------------------------------
		[/^(contact|privacy|settings|custom-rankings|ranker|rankersandbox)/, {}]
	];

	// Split a pretty URL into its path segments and any nested query string.
	// Multi Battle URLs historically smuggled extra options in a second "?",
	// e.g. "battle/multi/.../2-1/100/50/custom/?hp=100&energy=50/". Those get
	// flattened into the normal parameter bag here.

	function split(path){
		var nested = "";

		var q = path.indexOf("?");
		if(q >= 0){
			nested = path.substring(q + 1);
			path = path.substring(0, q);
		}

		return {
			path: path,
			segments: path.split("/").filter(function(s){
				return s.length > 0;
			}),
			nested: nested
		};
	}

	// Turn a pretty path string into the parameter bag the app expects.

	function decode(prettyPath){
		var parts = split(String(prettyPath).replace(/^https?:\/\/[^/]+/, "").replace(/^\/+/, ""));

		var params = {};
		var matched = false;

		for(var i = 0; i < RULES.length; i++){
			var match = parts.path.match(RULES[i][0]);

			if(match){
				var map = RULES[i][1];

				for(var key in map){
					if(! map.hasOwnProperty(key)){
						continue;
					}

					var value = match[map[key]];

					if(value !== undefined && value !== ""){
						// A group index of 0 means "the literal token that got us
						// here", so synthesize a truthy constant.
						params[key] = (map[key] === 0) ? "1" : value;
					}
				}

				matched = true;
				break;
			}
		}

		if(! matched){
			// No rule matched: pass the segments through positionally so nothing
			// is silently lost. Unknown shapes still round-trip.

			var segs = parts.segments;
			for(var n = 1; n < segs.length; n++){
				params["s" + n] = segs[n];
			}
		}

		// Fold in any nested query string (multi battle options, etc.)

		var extra = parseQuery(parts.nested);

		for(var k in extra){
			if(extra.hasOwnProperty(k)){
				params[k] = extra[k];
			}
		}

		return params;
	}

	// Which static file serves a given pretty path?

	function pageFile(prettyPath){
		var parts = split(String(prettyPath).replace(/^https?:\/\/[^/]+/, "").replace(/^\/+/, ""));
		var first = parts.segments[0] || "";

		if(PAGE_FILES.hasOwnProperty(first)){
			return PAGE_FILES[first];
		}

		// Articles all share one file that reads the article id from the path.

		return "index.html";
	}

	// Parse "a=1&b=2" into {a:"1", b:"2"}. Mirrors PHP's $_GET: everything is
	// a string, and duplicate keys collapse to the last value.

	function parseQuery(search){
		var out = {};

		if(! search){
			return out;
		}

		var str = String(search);

		// Tolerate a full URL or a leading "?"
		var q = str.indexOf("?");
		if(q >= 0){
			str = str.substring(q + 1);
		}

		// Drop any hash fragment
		var h = str.indexOf("#");
		if(h >= 0){
			str = str.substring(0, h);
		}

		if(str.length === 0){
			return out;
		}

		var pairs = str.split("&");

		for(var i = 0; i < pairs.length; i++){
			if(! pairs[i]){
				continue;
			}

			var eq = pairs[i].indexOf("=");
			var key = (eq >= 0) ? pairs[i].substring(0, eq) : pairs[i];
			var val = (eq >= 0) ? pairs[i].substring(eq + 1) : "";

			out[decodeURIComponent(key.replace(/\+/g, " "))] = decodeURIComponent(val.replace(/\+/g, " "));
		}

		return out;
	}

	// Serialize a parameter bag back into a query string, skipping empties so
	// URLs stay readable.

	function queryString(params){
		var parts = [];

		// Stable key order keeps generated URLs deterministic, which matters
		// because they end up in history entries and share links.
		var keys = Object.keys(params).sort(function(a, b){
			var order = ["mode","cp","cup","cat","p","p1","p2","p3","s","m1","m2","m3","cms","h","e",
				"hp","energy","cooldown","stats","timing","t","g1","matrix1","matrix2","sandbox","a"];
			var ia = order.indexOf(a);
			var ib = order.indexOf(b);

			if(ia === -1 && ib === -1){
				return a < b ? -1 : 1;
			} else if(ia === -1){
				return 1;
			} else if(ib === -1){
				return -1;
			}

			return ia - ib;
		});

		for(var i = 0; i < keys.length; i++){
			var value = params[keys[i]];

			if(value === undefined || value === null || value === ""){
				continue;
			}

			parts.push(encodeURIComponent(keys[i]) + "=" + encodeURIComponent(value));
		}

		return parts.join("&");
	}

	// Convert a pretty URL into a link that works on a plain static server.
	// This is the function that replaces `webRoot + prettyStr`.

	function url(prettyPath){
		var params = decode(prettyPath);
		var file = pageFile(prettyPath);
		var qs = queryString(params);

		var root = (typeof webRoot !== "undefined" && webRoot) ? webRoot : "/";

		return root + file + (qs.length ? "?" + qs : "");
	}

	// Absolute version of the above, for share links and analytics.

	function absoluteUrl(prettyPath){
		var path = url(prettyPath);
		var host = (typeof window !== "undefined") ? window.location.origin : "";

		return host + path;
	}

	// Absolute URL for a share link / <a href>. This is what `host + prettyStr`
	// was replaced with throughout the interface code.

	function href(prettyPath){
		return absoluteUrl(prettyPath);
	}

	return {
		url: url,
		href: href,
		absoluteUrl: absoluteUrl,
		decode: decode,
		encode: url,
		queryString: queryString,
		parseQuery: parseQuery,
		pageFile: pageFile,
		PAGE_FILES: PAGE_FILES
	};
})();

// Make it available to the same style of code that used to read `get`.
//
// The bare-name aliases let interface files say `url("battle/2500/...")`
// instead of `webRoot + "battle/2500/..."`, which is what every share-link and
// history-push site in the app now does.

// `url` and `href` are private to the IIFE above, so reference them through
// Router here. Naming them directly at this scope is a ReferenceError.

if(typeof window !== "undefined"){
	window.Router = Router;
	window.url = Router.url;
	window.href = Router.href;
}
