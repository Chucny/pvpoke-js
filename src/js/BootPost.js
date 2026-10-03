// BootPost.js
//
// Runs after Boot.js and jQuery are loaded, but before the page's own scripts.
// Carries over the per-request bits header.php used to do server-side that
// still need doing client-side: the "custom gamemaster is active" banner and
// the theme-dependent header logo.

(function(){
	// header.php only rendered the custom gamemaster banner server-side when
	// the settings cookie named a non-default gamemaster.

	if(settings.gamemaster != "gamemaster"){
		$(".custom-gm-banner").show();
	}

	// header.php swapped the header logo for the light variant on the night theme.

	if(settings.theme == "night"){
		$("header .header-wrap > a img").attr("src", webRoot + "img/themes/sunflower/header-white.png");
	}
})();
