export class ConnectionManager {
  constructor(selected = 8, onChange = () => {}) {
    this.selected = selected;
    this.effective = selected;
    this.consecutiveErrors = 0;
    this.consecutiveSuccesses = 0;
    this.onChange = onChange;
  }

  setSelected(value) {
    this.selected = value;
    this.effective = Math.min(this.effective, value);
    if (this.effective < 1) this.effective = 1;
  }

  reduce(reason, minimum = 1) {
    const before = this.effective;
    this.effective = Math.max(minimum, Math.ceil(this.effective / 2));
    this.consecutiveSuccesses = 0;
    if (before !== this.effective) this.onChange({ before, effective: this.effective, selected: this.selected, reason });
    return this.effective;
  }

  onRateLimited() {
    this.consecutiveErrors = 0;
    return this.reduce('The server returned HTTP 429; connection concurrency was reduced and the server retry delay will be respected.');
  }

  onForbidden() {
    this.consecutiveErrors = 0;
    const before = this.effective;
    this.effective = 1;
    if (before !== 1) this.onChange({ before, effective: 1, selected: this.selected, reason: 'The server denied a request (HTTP 403); concurrency was reduced. No access-control retry will be attempted.' });
    return this.effective;
  }

  onConnectionError() {
    this.consecutiveErrors += 1;
    this.consecutiveSuccesses = 0;
    if (this.consecutiveErrors >= 3) {
      this.consecutiveErrors = 0;
      return this.reduce('Repeated connection errors; concurrency was reduced to stabilize the transfer.');
    }
    return this.effective;
  }

  onSuccess() {
    this.consecutiveErrors = 0;
    this.consecutiveSuccesses += 1;
    if (this.consecutiveSuccesses >= 12 && this.effective < this.selected) {
      const before = this.effective;
      this.effective = Math.min(this.selected, this.effective + 1);
      this.consecutiveSuccesses = 0;
      this.onChange({ before, effective: this.effective, selected: this.selected, reason: 'The connection is stable; concurrency increased by one, without exceeding the selected limit.' });
    }
  }
}
