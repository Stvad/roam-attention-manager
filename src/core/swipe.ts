export type SwipeEventHandler = (event?: Event) => void;

export interface SwipeHandlers {
    onSwipeLeft?: SwipeEventHandler;
    onSwipeRight?: SwipeEventHandler;
    stopPropagation?: boolean;
}

export const addSwipeListeners = (
    element: HTMLElement,
    { onSwipeLeft, onSwipeRight, stopPropagation = false }: SwipeHandlers,
    threshold: number = 50
) => {
    let touchStartX: number = 0;
    let touchEndX: number = 0;

    const handleTouchStart = (event: TouchEvent): void => {
        if (stopPropagation) {
            event.stopPropagation();
        }
        touchStartX = event.changedTouches[0].screenX;
    };

    const handleTouchEnd = (event: TouchEvent): void => {
        if (stopPropagation) {
            event.stopPropagation();
        }
        touchEndX = event.changedTouches[0].screenX;
        handleSwipeGesture(event);
    };

    const handleSwipeGesture = (event: Event): void => {
        const distance = touchEndX - touchStartX;

        if (Math.abs(distance) > threshold) {
            if (distance < 0 && onSwipeLeft) {
                onSwipeLeft(event);
            } else if (distance > 0 && onSwipeRight) {
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
