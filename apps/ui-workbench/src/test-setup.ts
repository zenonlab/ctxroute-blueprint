import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

HTMLDialogElement.prototype.showModal = function showModal() {
  this.open = true;
};

HTMLDialogElement.prototype.close = function close() {
  this.open = false;
  this.dispatchEvent(new Event('close'));
};

afterEach(() => cleanup());
