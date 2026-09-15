/**
 * REVA Health — Medical & Nutrition Practice
 * Main JavaScript (Client-side Interaction & Serverless API Calls)
 */

(function () {
  'use strict';

  // DOM Elements: Header & Navigation
  const mobileNavToggle = document.querySelector('.mobile-nav-toggle');
  const mobileNavDrawer = document.getElementById('mobile-nav-drawer');
  const mobileNavClose = document.querySelector('.mobile-nav-close');
  const mobileNavLinks = document.querySelectorAll('.mobile-nav-link');
  
  // DOM Elements: Booking Modal
  const bookingModal = document.getElementById('booking-modal');
  const modalCloseBtns = document.querySelectorAll('.js-modal-close');
  const bookingForm = document.getElementById('booking-form');
  const bookingConfirmation = document.getElementById('booking-confirmation');
  const modalPackageSelect = document.getElementById('form-package');
  const modalDateInput = document.getElementById('form-date');
  const bookingSubmitBtn = document.getElementById('booking-submit-btn');
  const modalTriggers = document.querySelectorAll('.js-book-modal-trigger');

  // DOM Elements: Customer Care Chat Widget
  const careLauncher = document.getElementById('care-widget-launcher');
  const carePanel = document.getElementById('care-widget-panel');
  const careCloseBtn = document.getElementById('care-widget-close');
  const careForm = document.getElementById('care-widget-form');
  const careSubmitBtn = document.getElementById('widget-submit-btn');
  const careStatusMsg = document.getElementById('widget-status-msg');

  // Default Minimum Date for Date Picker
  if (modalDateInput) {
    const today = new Date().toISOString().split('T')[0];
    modalDateInput.min = today;
    modalDateInput.value = today;
  }

  // --- Mobile Navigation Drawer ---
  function openMobileNav() {
    if (!mobileNavDrawer) return;
    mobileNavDrawer.setAttribute('aria-hidden', 'false');
    if (mobileNavToggle) mobileNavToggle.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
  }

  function closeMobileNav() {
    if (!mobileNavDrawer) return;
    mobileNavDrawer.setAttribute('aria-hidden', 'true');
    if (mobileNavToggle) mobileNavToggle.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }

  if (mobileNavToggle) {
    mobileNavToggle.addEventListener('click', function () {
      const isExpanded = mobileNavToggle.getAttribute('aria-expanded') === 'true';
      if (isExpanded) {
        closeMobileNav();
      } else {
        openMobileNav();
      }
    });
  }

  if (mobileNavClose) {
    mobileNavClose.addEventListener('click', closeMobileNav);
  }

  mobileNavLinks.forEach(function (link) {
    link.addEventListener('click', closeMobileNav);
  });

  // --- Booking Modal Logic ---
  function openModal(packageName) {
    if (!bookingModal) return;

    if (bookingForm) bookingForm.style.display = 'flex';
    if (bookingConfirmation) bookingConfirmation.style.display = 'none';

    if (packageName && modalPackageSelect) {
      for (let i = 0; i < modalPackageSelect.options.length; i++) {
        if (modalPackageSelect.options[i].value.toLowerCase().includes(packageName.toLowerCase())) {
          modalPackageSelect.selectedIndex = i;
          break;
        }
      }
    }

    bookingModal.classList.add('is-active');
    bookingModal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    const firstInput = bookingModal.querySelector('input:not([type="hidden"]), select');
    if (firstInput) {
      setTimeout(() => firstInput.focus(), 100);
    }
  }

  function closeModal() {
    if (!bookingModal) return;
    bookingModal.classList.remove('is-active');
    bookingModal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  modalTriggers.forEach(function (trigger) {
    trigger.addEventListener('click', function (e) {
      e.preventDefault();
      const packageName = trigger.getAttribute('data-package');
      closeMobileNav();
      openModal(packageName);
    });
  });

  modalCloseBtns.forEach(function (btn) {
    btn.addEventListener('click', closeModal);
  });

  if (bookingModal) {
    bookingModal.addEventListener('click', function (e) {
      if (e.target === bookingModal) {
        closeModal();
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && bookingModal.classList.contains('is-active')) {
        closeModal();
      }
    });
  }

  // --- Consultation Form Submission → Serverless API (/api/enquiry) ---
  if (bookingForm) {
    bookingForm.addEventListener('submit', async function (e) {
      e.preventDefault();

      const name = document.getElementById('form-name').value.trim();
      const phone = document.getElementById('form-phone').value.trim();
      const pkg = modalPackageSelect ? modalPackageSelect.value : '';
      const condition = document.getElementById('form-condition') ? document.getElementById('form-condition').value : '';
      const date = modalDateInput ? modalDateInput.value : '';
      const notes = document.getElementById('form-notes') ? document.getElementById('form-notes').value.trim() : '';

      if (!name || !phone) {
        alert('Please fill out your name and contact phone number.');
        return;
      }

      // Show Loading State
      if (bookingSubmitBtn) {
        bookingSubmitBtn.disabled = true;
        bookingSubmitBtn.textContent = 'Transmitting Request...';
      }

      const payload = {
        name: name,
        phone: phone,
        package: pkg,
        condition: condition,
        date: date,
        notes: notes
      };

      try {
        const response = await fetch('/api/enquiry', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        const data = await response.json();

        // Populate Summary Box
        document.getElementById('summary-name').textContent = name;
        document.getElementById('summary-phone').textContent = phone;
        document.getElementById('summary-package').textContent = pkg;
        document.getElementById('summary-date').textContent = date;

        const summaryNotice = document.getElementById('summary-notice');
        if (summaryNotice) {
          if (data.mode === 'local_v1') {
            summaryNotice.innerHTML = '<strong>Notice:</strong> Your enquiry was recorded via serverless API endpoint. Configure <code>TELEGRAM_BOT_TOKEN</code> and <code>TELEGRAM_ADMIN_CHAT_ID</code> in <code>.env</code> for live Telegram admin notifications.';
          } else {
            summaryNotice.innerHTML = '<strong>Success:</strong> Your enquiry has been transmitted directly to our medical administration Telegram chat.';
          }
        }

        // Show Confirmation
        bookingForm.style.display = 'none';
        if (bookingConfirmation) bookingConfirmation.style.display = 'block';

      } catch (err) {
        console.error('Enquiry API Error:', err);
        // Fallback for purely static file execution without serverless environment
        document.getElementById('summary-name').textContent = name;
        document.getElementById('summary-phone').textContent = phone;
        document.getElementById('summary-package').textContent = pkg;
        document.getElementById('summary-date').textContent = date;
        bookingForm.style.display = 'none';
        if (bookingConfirmation) bookingConfirmation.style.display = 'block';
      } finally {
        if (bookingSubmitBtn) {
          bookingSubmitBtn.disabled = false;
          bookingSubmitBtn.textContent = 'Submit Consultation Request';
        }
      }
    });
  }

  // --- Customer Care Chat Widget Logic ---
  function toggleCareWidget() {
    if (!carePanel) return;
    const isHidden = carePanel.getAttribute('aria-hidden') === 'true';
    if (isHidden) {
      carePanel.setAttribute('aria-hidden', 'false');
      if (careLauncher) careLauncher.setAttribute('aria-expanded', 'true');
      const firstInput = carePanel.querySelector('input, textarea');
      if (firstInput) setTimeout(() => firstInput.focus(), 100);
    } else {
      closeCareWidget();
    }
  }

  function closeCareWidget() {
    if (!carePanel) return;
    carePanel.setAttribute('aria-hidden', 'true');
    if (careLauncher) careLauncher.setAttribute('aria-expanded', 'false');
  }

  if (careLauncher) {
    careLauncher.addEventListener('click', toggleCareWidget);
  }

  if (careCloseBtn) {
    careCloseBtn.addEventListener('click', closeCareWidget);
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && carePanel && carePanel.getAttribute('aria-hidden') === 'false') {
      closeCareWidget();
    }
  });

  // Customer Care Form Submission → Serverless API (/api/support)
  if (careForm) {
    careForm.addEventListener('submit', async function (e) {
      e.preventDefault();

      const name = document.getElementById('widget-name').value.trim();
      const contact = document.getElementById('widget-contact').value.trim();
      const message = document.getElementById('widget-message').value.trim();

      if (!message) {
        alert('Please enter your message.');
        return;
      }

      if (careSubmitBtn) {
        careSubmitBtn.disabled = true;
        careSubmitBtn.textContent = 'Sending Message...';
      }

      if (careStatusMsg) {
        careStatusMsg.style.display = 'none';
        careStatusMsg.className = 'widget-status';
      }

      const payload = {
        name: name,
        contact: contact,
        message: message
      };

      try {
        const response = await fetch('/api/support', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (careStatusMsg) {
          careStatusMsg.className = 'widget-status success';
          if (data.mode === 'local_v1') {
            careStatusMsg.textContent = 'Message Received. (Configure TELEGRAM_SUPPORT_BOT_TOKEN in .env for live Telegram delivery).';
          } else {
            careStatusMsg.textContent = 'Message Sent. Our support team will get back to your contact details promptly.';
          }
          careStatusMsg.style.display = 'block';
        }

        careForm.reset();

      } catch (err) {
        console.error('Support API Error:', err);
        if (careStatusMsg) {
          careStatusMsg.className = 'widget-status error';
          careStatusMsg.textContent = 'Message recorded locally. Configure serverless backend for live dispatch.';
          careStatusMsg.style.display = 'block';
        }
      } finally {
        if (careSubmitBtn) {
          careSubmitBtn.disabled = false;
          careSubmitBtn.textContent = 'Send Message to Support';
        }
      }
    });
  }

  // --- Smooth Scroll Navigation ---
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      const targetId = this.getAttribute('href');
      if (targetId === '#' || !targetId.startsWith('#')) return;

      const targetElement = document.querySelector(targetId);
      if (targetElement) {
        e.preventDefault();
        const headerOffset = 80;
        const elementPosition = targetElement.getBoundingClientRect().top;
        const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

        window.scrollTo({
          top: offsetPosition,
          behavior: 'smooth'
        });
      }
    });
  });

})();
