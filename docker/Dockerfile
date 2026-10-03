# PvPoke is a fully static site. This image does nothing but hand files out of
# src/ -- there is no server-side language to install, nothing to compile, and
# nothing to configure per request.
#
# This replaces the `php:apache-buster` image the project used before the
# conversion, which needed `a2enmod rewrite` because src/.htaccess turned pretty
# URLs into query strings for .php scripts to read. That .htaccess came with the
# PHP tree, which is no longer in this repository, and js/Router.js does the same
# translation in the browser, so every link the app generates already resolves
# to a real file ("rankings.html?cup=ultra&cp=1500"). Nothing needs rewriting
# here, which is why there is no mod_rewrite equivalent below.
FROM nginx:alpine

# Serve src/ as the document root. WEB_ROOT in js/Boot.js is "/", so the site
# must be mounted at the server root rather than in a subdirectory the way the
# old PHP setup served it from /pvpoke/src/.
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
