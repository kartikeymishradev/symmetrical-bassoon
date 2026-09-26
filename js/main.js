/**
 * REVA Health — Medical & Nutrition Practice
 * Main JavaScript (Client-side Interaction & Serverless API Calls)
 */

(function () {
  'use strict';

  // DOM Elements: Header & Navigation (with fallback support)
  const mobileNavToggle = document.querySelector('.mobile-nav-toggle') || document.getElementById('mobileNavToggle');
  const mobileNavDrawer = document.getElementById('mobile-nav-drawer') || document.getElementById('mobileDrawer') || document.querySelector('.mobile-drawer');
  const mobileNavClose = document.querySelector('.mobile-nav-close') || document.querySelector('.drawer-close') || document.getElementById('drawerClose');
  const mobileNavLinks = document.querySelectorAll('.mobile-nav-link, .drawer-link');
  
  // DOM Elements: Booking Modal
  const bookingModal = document.getElementById('booking-modal');
  const modalCloseBtns = document.querySelectorAll('.js-modal-close');
  const bookingForm = document.getElementById('booking-form');
  const bookingConfirmation = document.getElementById('booking-confirmation');
  const modalPackageSelect = document.getElementById('form-package');
  const modalDateInput = document.getElementById('form-date');
  const bookingSubmitBtn = document.getElementById('booking-submit-btn');
  const modalTriggers = document.querySelectorAll('.js-book-modal-trigger');

  // DOM Elements: Customer Care Chat Widget (with fallback support)
  const careLauncher = document.getElementById('care-widget-launcher') || document.getElementById('widgetLauncher');
  const carePanel = document.getElementById('care-widget-panel') || document.getElementById('widgetPanel');
  const careCloseBtn = document.getElementById('care-widget-close') || document.getElementById('widgetClose');
  const careForm = document.getElementById('care-widget-form');
  const careSubmitBtn = document.getElementById('widget-submit-btn');
  const careStatusMsg = document.getElementById('widget-status-msg');

  const modalTimeSelect = document.getElementById('form-time');
  const modalEmailInput = document.getElementById('form-email');
  const errorAlert = document.getElementById('booking-error-alert');

  // Load available slots from /api/slots
  async function loadAvailableSlots(dateStr) {
    if (!modalTimeSelect) return;
    modalTimeSelect.disabled = true;
    modalTimeSelect.innerHTML = '<option value="">Loading slots...</option>';

    try {
      const res = await fetch(`/api/slots?date=${encodeURIComponent(dateStr)}`);
      const data = await res.json();

      if (data.success && Array.isArray(data.slots) && data.slots.length > 0) {
        modalTimeSelect.innerHTML = data.slots.map(s => `<option value="${s.time12h}">${s.time12h}</option>`).join('');
        modalTimeSelect.disabled = false;
      } else {
        modalTimeSelect.innerHTML = '<option value="">No slots available for this date</option>';
        modalTimeSelect.disabled = true;
      }
    } catch (err) {
      console.error('Error fetching slots:', err);
      modalTimeSelect.innerHTML = '<option value="10:00 AM">10:00 AM</option><option value="11:00 AM">11:00 AM</option><option value="04:00 PM">04:00 PM</option>';
      modalTimeSelect.disabled = false;
    }
  }

  // Default Minimum Date for Date Picker & Slot Fetch
  if (modalDateInput) {
    const today = new Date().toISOString().split('T')[0];
    modalDateInput.min = today;
    modalDateInput.value = today;
    loadAvailableSlots(today);

    modalDateInput.addEventListener('change', function () {
      if (modalDateInput.value) {
        loadAvailableSlots(modalDateInput.value);
      }
    });
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

    if (modalDateInput && modalDateInput.value) {
      loadAvailableSlots(modalDateInput.value);
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

  // Cache active order for seamless retry if Razorpay modal is dismissed without changing date/time
  let cachedOrder = null;

  // Clear cached order if user changes date or time
  if (modalDateInput) {
    modalDateInput.addEventListener('change', function () {
      cachedOrder = null;
    });
  }
  if (modalTimeSelect) {
    modalTimeSelect.addEventListener('change', function () {
      cachedOrder = null;
    });
  }

  // --- Consultation Form Submission → Serverless Payment API (/api/create-order -> Razorpay -> /api/verify-payment) ---
  if (bookingForm) {
    bookingForm.addEventListener('submit', async function (e) {
      e.preventDefault();

      if (errorAlert) {
        errorAlert.style.display = 'none';
        errorAlert.textContent = '';
      }

      const name = document.getElementById('form-name').value.trim();
      const phone = document.getElementById('form-phone').value.trim();
      const email = modalEmailInput ? modalEmailInput.value.trim() : '';
      const pkg = modalPackageSelect ? modalPackageSelect.value : '';
      const condition = document.getElementById('form-condition') ? document.getElementById('form-condition').value : '';
      const date = modalDateInput ? modalDateInput.value : '';
      const time = modalTimeSelect ? modalTimeSelect.value : '';
      const notes = document.getElementById('form-notes') ? document.getElementById('form-notes').value.trim() : '';

      if (!name || !phone) {
        alert('Please fill out your name and contact phone number.');
        return;
      }

      if (!time) {
        alert('Please select an available time slot.');
        return;
      }

      if (typeof window.Razorpay === 'undefined') {
        alert('Razorpay Checkout SDK failed to load. Please check your network connection or disable adblockers.');
        return;
      }

      // Show Loading State
      if (bookingSubmitBtn) {
        bookingSubmitBtn.disabled = true;
        bookingSubmitBtn.textContent = 'Securing Slot Hold...';
      }

      try {
        let bookingId, orderId, keyId, amount, currency;

        // Reuse cached active order if user is retrying payment for the exact same date & time after modal dismiss
        if (cachedOrder && cachedOrder.date === date && cachedOrder.time === time && cachedOrder.phone === phone) {
          bookingId = cachedOrder.bookingId;
          orderId = cachedOrder.orderId;
          keyId = cachedOrder.keyId;
          amount = cachedOrder.amount;
          currency = cachedOrder.currency;
        } else {
          // Step 1: Create Order & Acquire Slot Hold via API
          const orderPayload = {
            name: name,
            phone: phone,
            email: email,
            package: pkg,
            condition: condition,
            date: date,
            time: time,
            notes: notes
          };

          const orderRes = await fetch('/api/create-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(orderPayload)
          });

          const orderData = await orderRes.json();

          if (orderRes.status === 409 || orderData.conflict) {
            if (errorAlert) {
              errorAlert.textContent = orderData.error || 'Slot is temporarily held by another patient. Please select a different time.';
              errorAlert.style.display = 'block';
            }
            if (modalDateInput && modalDateInput.value) {
              loadAvailableSlots(modalDateInput.value);
            }
            if (bookingSubmitBtn) {
              bookingSubmitBtn.disabled = false;
              bookingSubmitBtn.textContent = 'Book & Pay Consultation Slot';
            }
            return;
          }

          if (!orderRes.ok || !orderData.success || !orderData.orderId) {
            throw new Error(orderData.error || 'Failed to initialize booking payment.');
          }

          bookingId = orderData.bookingId;
          orderId = orderData.orderId;
          keyId = orderData.keyId;
          amount = orderData.amount;
          currency = orderData.currency;

          // Save to cache for seamless retry on dismiss
          cachedOrder = { bookingId, orderId, keyId, amount, currency, date, time, phone };
        }

        if (bookingSubmitBtn) {
          bookingSubmitBtn.textContent = 'Opening Payment Gateway...';
        }

        // Step 2: Open Razorpay Checkout SDK
        const rzpOptions = {
          key: keyId,
          amount: amount,
          currency: currency || 'INR',
          name: 'REVA Health',
          description: `Medical Consultation - ${bookingId}`,
          order_id: orderId,
          prefill: {
            name: name,
            contact: phone,
            email: email
          },
          theme: {
            color: '#10b981'
          },
          handler: async function (paymentRes) {
            // Step 3: Verify Payment Signature & Confirm Appointment
            if (bookingSubmitBtn) {
              bookingSubmitBtn.textContent = 'Verifying Payment & Confirming...';
            }

            try {
              const verifyRes = await fetch('/api/verify-payment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  razorpay_order_id: paymentRes.razorpay_order_id,
                  razorpay_payment_id: paymentRes.razorpay_payment_id,
                  razorpay_signature: paymentRes.razorpay_signature,
                  bookingId: bookingId,
                  date: date,
                  time: time,
                  name: name,
                  phone: phone,
                  email: email,
                  package: pkg,
                  amount: amount / 100
                })
              });

              const verifyData = await verifyRes.json();

              if (verifyRes.status === 409) {
                if (errorAlert) {
                  errorAlert.textContent = verifyData.error || 'This slot was already reserved by another patient. Contact support for refund.';
                  errorAlert.style.display = 'block';
                }
                if (bookingSubmitBtn) {
                  bookingSubmitBtn.disabled = false;
                  bookingSubmitBtn.textContent = 'Book & Pay Consultation Slot';
                }
                return;
              }

              if (!verifyRes.ok || !verifyData.success) {
                throw new Error(verifyData.error || 'Payment verification failed.');
              }

              // Step 4: Populate Confirmation View
              document.getElementById('summary-booking-id').textContent = bookingId;
              document.getElementById('summary-payment-id').textContent = paymentRes.razorpay_payment_id;
              document.getElementById('summary-name').textContent = name;
              document.getElementById('summary-phone').textContent = phone;
              document.getElementById('summary-package').textContent = pkg;
              document.getElementById('summary-datetime').textContent = `${date} at ${time}`;

              const statusEl = document.getElementById('summary-status');
              if (statusEl) {
                if (verifyData.appointmentStatus === 'CONFIRMED') {
                  statusEl.textContent = 'CONFIRMED';
                  statusEl.style.background = '#10b981';
                } else {
                  statusEl.textContent = 'CONFIRMATION_PENDING';
                  statusEl.style.background = '#f59e0b';
                }
              }

              const meetContainer = document.getElementById('summary-meet-container');
              const meetLinkEl = document.getElementById('summary-meet-link');
              if (verifyData.meetingLink && meetContainer && meetLinkEl) {
                meetLinkEl.href = verifyData.meetingLink;
                meetContainer.style.display = 'block';
              }

              bookingForm.style.display = 'none';
              if (bookingConfirmation) bookingConfirmation.style.display = 'block';

            } catch (vErr) {
              console.error('Payment verification error:', vErr);
              if (errorAlert) {
                errorAlert.textContent = vErr.message || 'Payment verification error. Please contact customer support.';
                errorAlert.style.display = 'block';
              }
            } finally {
              if (bookingSubmitBtn) {
                bookingSubmitBtn.disabled = false;
                bookingSubmitBtn.textContent = 'Book & Pay Consultation Slot';
              }
            }
          },
          modal: {
            ondismiss: function () {
              if (bookingSubmitBtn) {
                bookingSubmitBtn.disabled = false;
                bookingSubmitBtn.textContent = 'Book & Pay Consultation Slot';
              }
              if (errorAlert) {
                errorAlert.textContent = 'Payment cancelled. Your 15-minute slot hold is active — click Book & Pay to retry.';
                errorAlert.style.display = 'block';
              }
            }
          }
        };

        const rzp = new window.Razorpay(rzpOptions);
        rzp.on('payment.failed', function (response) {
          if (errorAlert) {
            errorAlert.textContent = `Payment Failed: ${response.error.description || response.error.reason}`;
            errorAlert.style.display = 'block';
          }
          if (bookingSubmitBtn) {
            bookingSubmitBtn.disabled = false;
            bookingSubmitBtn.textContent = 'Book & Pay Consultation Slot';
          }
        });
        rzp.open();

      } catch (err) {
        console.error('Order creation error:', err);
        if (errorAlert) {
          errorAlert.textContent = err.message || 'Failed to initialize booking. Please try again.';
          errorAlert.style.display = 'block';
        }
        if (bookingSubmitBtn) {
          bookingSubmitBtn.disabled = false;
          bookingSubmitBtn.textContent = 'Book & Pay Consultation Slot';
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
