export type SwipeEventHandler = (event?: Event) => void;

export interface SwipeHandlers {
    onSwipeLeft?: SwipeEventHandler;
    onSwipeRight?: SwipeEventHandler;
    stopPropagation?: boolean;
    threshold?: number;
    maxVerticalThreshold?: number;
}

export const addSwipeListeners = (
    element: HTMLElement,
    {
        onSwipeLeft,
        onSwipeRight,
        stopPropagation = false,
        threshold = 100,
        maxVerticalThreshold = 50,
    }: SwipeHandlers
) => {
    let touchStartX: number = 0;
    let touchEndX: number = 0;
    let touchStartY: number = 0;
    let touchEndY: number = 0;

    const handleTouchStart = (event: TouchEvent): void => {
        if (stopPropagation) {
            event.stopPropagation();
        }
        touchStartX = event.changedTouches[0].screenX;
        touchStartY = event.changedTouches[0].screenY;
    };

    const handleTouchEnd = (event: TouchEvent): void => {
        if (stopPropagation) {
            event.stopPropagation();
        }
        touchEndX = event.changedTouches[0].screenX;
        touchEndY = event.changedTouches[0].screenY;
        handleSwipeGesture(event);
    };

    const handleSwipeGesture = (event: Event): void => {
        const horizontalDistance = touchEndX - touchStartX;
        const verticalDistance = Math.abs(touchEndY - touchStartY);

        // Check that the swipe meets the horizontal threshold and does not exceed the vertical threshold
        if (Math.abs(horizontalDistance) > threshold && verticalDistance <= maxVerticalThreshold) {
            if (horizontalDistance < 0 && onSwipeLeft) {
                onSwipeLeft(event);
            } else if (horizontalDistance > 0 && onSwipeRight) {
                onSwipeRight(event);
            }
        }
    };

    element.addEventListener('touchstart', handleTouchStart, false);
    element.addEventListener('touchend', handleTouchEnd, false);

    // Return a function to remove the listeners if needed
    return () => {
        element.removeEventListener('touchstart', handleTouchStart);
        element.removeEventListener('touchend', handleTouchEnd);
    };
};
