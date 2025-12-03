function showAlert(title, message) {
  return new Promise((resolve) => {
    const modal = document.getElementById('alert-modal');
    const titleEl = document.getElementById('alert-modal-title');
    const messageEl = document.getElementById('alert-modal-message');
    const okBtn = document.getElementById('alert-modal-ok');

    titleEl.textContent = title || 'Alert';
    messageEl.textContent = message || '';
    modal.style.display = 'flex';

    const handleOk = () => {
      modal.style.display = 'none';
      okBtn.removeEventListener('click', handleOk);
      resolve();
    };

    okBtn.onclick = handleOk;

    modal.onclick = (e) => {
      if (e.target === modal) {
        handleOk();
      }
    };

    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        handleOk();
        document.removeEventListener('keydown', handleEscape);
      }
    };
    document.addEventListener('keydown', handleEscape);
  });
}

function showConfirm(title, message) {
  return new Promise((resolve) => {
    const modal = document.getElementById('confirm-modal');
    const titleEl = document.getElementById('confirm-modal-title');
    const messageEl = document.getElementById('confirm-modal-message');
    const okBtn = document.getElementById('confirm-modal-ok');
    const cancelBtn = document.getElementById('confirm-modal-cancel');

    titleEl.textContent = title || 'Confirm';
    messageEl.textContent = message || '';
    modal.style.display = 'flex';

    const handleOk = () => {
      modal.style.display = 'none';
      okBtn.removeEventListener('click', handleOk);
      cancelBtn.removeEventListener('click', handleCancel);
      document.removeEventListener('keydown', handleEscape);
      resolve(true);
    };

    const handleCancel = () => {
      modal.style.display = 'none';
      okBtn.removeEventListener('click', handleOk);
      cancelBtn.removeEventListener('click', handleCancel);
      document.removeEventListener('keydown', handleEscape);
      resolve(false);
    };

    okBtn.onclick = handleOk;
    cancelBtn.onclick = handleCancel;

    modal.onclick = (e) => {
      if (e.target === modal) {
        handleCancel();
      }
    };

    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        handleCancel();
      }
    };
    document.addEventListener('keydown', handleEscape);

    okBtn.focus();
  });
}

function showPrompt(title, message, defaultValue = '') {
  return new Promise((resolve) => {
    const modal = document.getElementById('prompt-modal');
    const titleEl = document.getElementById('prompt-modal-title');
    const messageEl = document.getElementById('prompt-modal-message');
    const inputEl = document.getElementById('prompt-modal-input');
    const okBtn = document.getElementById('prompt-modal-ok');
    const cancelBtn = document.getElementById('prompt-modal-cancel');

    titleEl.textContent = title || 'Input';
    messageEl.textContent = message || '';
    inputEl.value = defaultValue;
    modal.style.display = 'flex';
    inputEl.focus();
    inputEl.select();

    const handleOk = () => {
      const value = inputEl.value;
      modal.style.display = 'none';
      okBtn.removeEventListener('click', handleOk);
      cancelBtn.removeEventListener('click', handleCancel);
      inputEl.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keydown', handleEscape);
      resolve(value);
    };

    const handleCancel = () => {
      modal.style.display = 'none';
      okBtn.removeEventListener('click', handleOk);
      cancelBtn.removeEventListener('click', handleCancel);
      inputEl.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keydown', handleEscape);
      resolve(null);
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Enter') {
        handleOk();
      }
    };

    okBtn.onclick = handleOk;
    cancelBtn.onclick = handleCancel;
    inputEl.addEventListener('keydown', handleKeyDown);

    modal.onclick = (e) => {
      if (e.target === modal) {
        handleCancel();
      }
    };

    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        handleCancel();
      }
    };
    document.addEventListener('keydown', handleEscape);
  });
}

function registerNativeOverrides() {
  window.alert = showAlert;
  window.confirm = (message) => showConfirm('Confirm', message);
  window.prompt = (message, defaultValue) => showPrompt('Input', message, defaultValue);
}

module.exports = {
  showAlert,
  showConfirm,
  showPrompt,
  registerNativeOverrides,
};




