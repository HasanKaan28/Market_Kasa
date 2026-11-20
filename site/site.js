/* Market Kasa site: the WhatsApp links, the scroll reveals, the header's shadow and the hero's
   tilt. Plain JavaScript, no dependencies, no build step. Motion is transform and opacity only;
   with reduced motion nothing moves and every part shows at once. */
(function () {
  'use strict';

  var doc = document;
  var root = doc.documentElement;
  var motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var $ = function (sel, scope) {
    return (scope || doc).querySelector(sel);
  };
  var $$ = function (sel, scope) {
    return Array.prototype.slice.call((scope || doc).querySelectorAll(sel));
  };

  // The setup code comes from the seller: a WhatsApp chat with the message written in, once the
  // number is set in config.js. Without a number the hidden buttons stay hidden, the visible
  // links keep their jump to the code block, and the line under the button says to get in touch.
  var WHATSAPP_TEXT = 'Merhaba, Market Kasa için kurulum kodu almak istiyorum.';
  /** 905524754711 as "+90 552 475 47 11"; any other length as "+" and the digits. */
  function phoneLabel(number) {
    var m = /^90(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(number);
    return m ? '+90 ' + m[1] + ' ' + m[2] + ' ' + m[3] + ' ' + m[4] : '+' + number;
  }
  function initContact() {
    var config = window.MK_SITE || {};
    var number = String(config.whatsapp || '').replace(/\D/g, '');
    if (number.length < 10) return;
    $$('[data-whatsapp]').forEach(function (link) {
      link.href = 'https://wa.me/' + number + '?text=' + encodeURIComponent(WHATSAPP_TEXT);
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.hidden = false;
    });
    $$('[data-whatsapp-number]').forEach(function (line) {
      line.textContent = 'WhatsApp: ' + phoneLabel(number);
      line.hidden = false;
    });
    $$('[data-contact-fallback]').forEach(function (line) {
      line.hidden = true;
    });
    initFloatingContact();
  }

  // The phone's round WhatsApp button steps aside while a part of the page that has its own way
  // to write is on screen.
  function initFloatingContact() {
    var link = $('[data-wa-float]');
    if (!link) return;
    if (!('IntersectionObserver' in window)) {
      link.classList.remove('is-away');
      return;
    }
    var watched = ['.hero', '#kod', '#indir', '.foot']
      .map(function (sel) {
        return $(sel);
      })
      .filter(Boolean);
    var onScreen = watched.map(function () {
      return false;
    });
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        onScreen[watched.indexOf(entry.target)] = entry.isIntersecting;
      });
      link.classList.toggle('is-away', onScreen.indexOf(true) !== -1);
    });
    watched.forEach(function (node) {
      observer.observe(node);
    });
  }

  // Each .reveal rises in once, the first time a sixth of it is on screen. Siblings that arrive
  // together follow each other by 70 ms. The setup steps draw their line and number in turn.
  function initReveals() {
    var items = $$('.reveal, [data-steps]');
    if (!('IntersectionObserver' in window) || motion.matches) {
      items.forEach(function (node) {
        node.classList.add('is-in');
      });
      return;
    }
    // Only now are the parts below the fold hidden (style.css): without this script they show.
    root.classList.add('reveals');
    items.forEach(function (node) {
      var siblings = node.parentElement ? $$(':scope > .reveal', node.parentElement) : [];
      var index = siblings.indexOf(node);
      if (index > 0) node.style.setProperty('--delay', Math.min(index, 6) * 70 + 'ms');
    });
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-in');
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.16, rootMargin: '0px 0px -6% 0px' },
    );
    items.forEach(function (node) {
      observer.observe(node);
    });
  }

  // The header gains its line and shadow once the page has scrolled under it.
  function initHeader() {
    var header = $('.top');
    var hero = $('.hero');
    if (!header || !hero || !('IntersectionObserver' in window)) return;
    var sentinel = doc.createElement('div');
    sentinel.setAttribute('aria-hidden', 'true');
    sentinel.className = 'top-sentinel';
    hero.insertBefore(sentinel, hero.firstChild);
    new IntersectionObserver(function (entries) {
      header.classList.toggle('is-scrolled', !entries[0].isIntersecting);
    }).observe(sentinel);
  }

  // On a desktop with a mouse the hero's window leans a little toward the pointer. One frame
  // per pointer move at most; only a transform changes.
  function initTilt() {
    var shot = $('[data-tilt]');
    var fine = window.matchMedia('(hover: hover) and (pointer: fine)');
    if (!shot || !fine.matches || motion.matches) return;
    var frame = 0;
    var x = 0;
    var y = 0;
    function apply() {
      frame = 0;
      shot.style.setProperty('--tilt-x', (y * -3).toFixed(2) + 'deg');
      shot.style.setProperty('--tilt-y', (x * 4).toFixed(2) + 'deg');
    }
    shot.addEventListener('pointermove', function (event) {
      var box = shot.getBoundingClientRect();
      x = (event.clientX - box.left) / box.width - 0.5;
      y = (event.clientY - box.top) / box.height - 0.5;
      if (!frame) frame = requestAnimationFrame(apply);
    });
    shot.addEventListener('pointerleave', function () {
      x = 0;
      y = 0;
      if (!frame) frame = requestAnimationFrame(apply);
    });
  }

  function start() {
    initContact();
    initReveals();
    initHeader();
    initTilt();
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start);
  else start();
})();
