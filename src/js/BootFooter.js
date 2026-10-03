// BootFooter.js
//
// The interactive bits that footer.php used to carry inline: the mobile menu,
// share-link copying, toggleable sections, and service worker registration.

(function(){
	// One-time migration of custom_group cookies into localStorage, replacing
	// the PHP block that footer.php emitted.

	window.migrateCustomGroups();

	var menuSlideProtection = false;

	$(".hamburger.mobile").click(function(e){
		$("header .menu").slideToggle(125);

		menuSlideProtection = true;
		setTimeout(function(){
			menuSlideProtection = false;
		}, 125);
	});

	// Submenu interaction on desktop and mobile

	$(".menu .parent-menu").on("mouseenter click", function(e){

		if(screen.width >= 721){
			$(".submenu").removeClass("active");
			$(this).find(".submenu").addClass("active");
		}
	});

	$(".menu .parent-menu > a").on("click", function(e){
		if($(e.target).is("span") && screen.width < 721){
			e.preventDefault();
			$(this).toggleClass("active");
			$(this).next(".submenu").toggleClass("active");
		}
	});

	$("body").on("mousemove click", function(e){
		if($(".submenu:hover, .parent-menu:hover").length == 0){
			$(".submenu").removeClass("active");
		}

		if(screen.width <= 720 && ! menuSlideProtection){
			if($("header .menu:hover, .hamburger.mobile:hover").length == 0 && $("header .menu").css("display") == "block"){
				$("header .menu").slideToggle(125);

				menuSlideProtection = true;
				setTimeout(function(){
					menuSlideProtection = false;
				}, 125);
			}
		}
	});

	$("header .latest-section a").click(function(e){
		$("header .menu").slideToggle(125);
	});

	// Auto select link

	$(".share-link input").click(function(e){
		this.setSelectionRange(0, this.value.length);
	});

	// Link share copying

	$("body").on("click", ".share-link .copy", function(e){
		var el = $(e.target).prev()[0];
		el.focus();
		el.setSelectionRange(0, el.value.length);
		document.execCommand("copy");
	});

	// Toggleable sections

	$("body").on("click", ".toggle", function(e){
		e.preventDefault();

		$(e.target).closest(".toggle").toggleClass("active");
	});

	// disable mousewheel on an input number field when in focus
	// (to prevent Chromium browsers changing the value when scrolling)

	$("body").on("focus", "input[type=number]", function(e){
		$(this).on("wheel.disableScroll", function(e){
			e.preventDefault();
		});
	});

	$("body").on("blur", "input[type=number]", function(e){
		$(this).off("wheel.disableScroll");
	});

	// Service worker handler.
	//
	// The original registered unconditionally, which broke local development
	// (it cached stale assets). Only register on https, where service workers
	// are actually allowed and where caching is useful.

	if("serviceWorker" in navigator && window.isSecureContext && ! window.location.hostname.match(/^(localhost|127\.0\.0\.1)$/)){
		navigator.serviceWorker.register(webRoot + "service-worker.js")
			.then(function(){
				console.log("Service worker registered.");
			}).catch(function(err){
				console.log("Service worker failed to register:", err);
			});
	}
})();
