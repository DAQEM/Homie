export class PagingController {
  pagePosition = $state<number>(0);
  isPageDragging = $state<boolean>(false);
  pageSlideDirection = $state<"left" | "right" | null>(null);

  private rawSwipePagePos = 0;
  private pageVelocity = 0;
  private springRafId: number | null = null;
  private springTargetIndex = 0;
  private springLastTime = 0;
  private wheelGestureTimer: ReturnType<typeof setTimeout> | null = null;
  private wheelLastEventAt = 0;
  private wheelLockedAfterSnapUntil = 0;

  syncToIndex(idx: number): void {
    this.pagePosition = idx;
    this.rawSwipePagePos = idx;
    this.springTargetIndex = idx;
  }

  get isAnimating(): boolean {
    return this.isPageDragging || this.springRafId !== null;
  }

  get currentVelocity(): number {
    return this.pageVelocity;
  }

  private applyRubberBand(rawPagePos: number, workspaceCount: number): number {
    const maxIndex = Math.max(0, workspaceCount - 1);
    const limit = 0.26;
    if (rawPagePos < 0) {
      const over = -rawPagePos;
      return -limit * (1 - Math.exp(-over / limit));
    }
    if (rawPagePos > maxIndex) {
      const over = rawPagePos - maxIndex;
      return maxIndex + limit * (1 - Math.exp(-over / limit));
    }
    return rawPagePos;
  }

  stopPageSpring(): void {
    if (this.springRafId !== null && typeof cancelAnimationFrame !== "undefined") {
      cancelAnimationFrame(this.springRafId);
      this.springRafId = null;
    }
  }

  springToPage(targetIndex: number, workspaceCount: number, initialVelocity = 0): void {
    const maxIndex = Math.max(0, workspaceCount - 1);
    const clampedIndex = Math.max(0, Math.min(maxIndex, targetIndex));
    this.springTargetIndex = clampedIndex;
    this.rawSwipePagePos = clampedIndex;
    this.pageVelocity = initialVelocity;

    if (typeof requestAnimationFrame === "undefined") {
      this.pagePosition = clampedIndex;
      return;
    }

    this.stopPageSpring();
    this.springLastTime = performance.now();

    const stiffness = 320;
    const damping = 34;

    const step = (now: number) => {
      const dt = Math.min((now - this.springLastTime) / 1000, 0.032);
      this.springLastTime = now;

      const displacement = this.pagePosition - this.springTargetIndex;
      const springForce = -stiffness * displacement;
      const dampingForce = -damping * this.pageVelocity;
      const acceleration = springForce + dampingForce;

      this.pageVelocity += acceleration * dt;
      this.pagePosition += this.pageVelocity * dt;

      if (
        Math.abs(this.pagePosition - this.springTargetIndex) < 0.0008 &&
        Math.abs(this.pageVelocity) < 0.008
      ) {
        this.pagePosition = this.springTargetIndex;
        this.pageVelocity = 0;
        this.springRafId = null;
        return;
      }

      this.springRafId = requestAnimationFrame(step);
    };

    this.springRafId = requestAnimationFrame(step);
  }

  beginPageSwipe(): void {
    this.stopPageSpring();
    this.isPageDragging = true;
    this.rawSwipePagePos = this.pagePosition;
    this.pageVelocity = 0;
  }

  updatePageSwipe(deltaPages: number, dtMs: number, workspaceCount: number): void {
    if (!this.isPageDragging) {
      this.beginPageSwipe();
    }
    this.rawSwipePagePos += deltaPages;
    const nextPos = this.applyRubberBand(this.rawSwipePagePos, workspaceCount);
    if (dtMs > 0) {
      const instantVelocity = (nextPos - this.pagePosition) / (dtMs / 1000);
      this.pageVelocity = this.pageVelocity * 0.35 + instantVelocity * 0.65;
    }
    this.pagePosition = nextPos;
  }

  endPageSwipe(
    currentAnchor: number,
    workspaceCount: number,
    onSnapToIndex: (nextIdx: number, direction: "left" | "right") => void,
  ): void {
    if (!this.isPageDragging) return;
    this.isPageDragging = false;

    const maxIndex = Math.max(0, workspaceCount - 1);
    const projected = this.pagePosition + this.pageVelocity * 0.16;
    const diff = projected - currentAnchor;

    let nextIdx = currentAnchor;
    if (diff > 0.22) {
      nextIdx = Math.min(maxIndex, currentAnchor + 1);
    } else if (diff < -0.22) {
      nextIdx = Math.max(0, currentAnchor - 1);
    } else {
      nextIdx = Math.max(0, Math.min(maxIndex, Math.round(projected)));
    }

    if (nextIdx !== currentAnchor) {
      const direction = nextIdx > currentAnchor ? "right" : "left";
      this.pageSlideDirection = direction;
      onSnapToIndex(nextIdx, direction);
    }

    this.springToPage(nextIdx, workspaceCount, this.pageVelocity);
  }

  handleWheelPaging(
    deltaX: number,
    viewportWidth: number,
    currentAnchor: number,
    workspaceCount: number,
    callbacks: {
      onSelectNext: () => void;
      onSelectPrev: () => void;
      onEndSwipe: () => void;
    },
  ): void {
    const now = performance.now();
    if (now < this.wheelLockedAfterSnapUntil) return;

    const dt = this.wheelLastEventAt > 0 ? Math.max(8, now - this.wheelLastEventAt) : 16;
    this.wheelLastEventAt = now;

    const isDiscreteStep = Math.abs(deltaX) >= 95 && dt > 90;
    if (isDiscreteStep && !this.isPageDragging) {
      this.wheelLockedAfterSnapUntil = now + 420;
      if (deltaX > 0) {
        callbacks.onSelectNext();
      } else {
        callbacks.onSelectPrev();
      }
      return;
    }

    const stride = Math.max(viewportWidth * 0.78, 520);
    const deltaPages = deltaX / stride;
    this.updatePageSwipe(deltaPages, dt, workspaceCount);

    const displacement = this.rawSwipePagePos - currentAnchor;
    if (Math.abs(displacement) > 0.55) {
      if (this.wheelGestureTimer) {
        clearTimeout(this.wheelGestureTimer);
        this.wheelGestureTimer = null;
      }
      this.wheelLockedAfterSnapUntil = now + 380;
      callbacks.onEndSwipe();
      return;
    }

    if (this.wheelGestureTimer) {
      clearTimeout(this.wheelGestureTimer);
    }
    this.wheelGestureTimer = setTimeout(() => {
      this.wheelGestureTimer = null;
      callbacks.onEndSwipe();
    }, 115);
  }
}
