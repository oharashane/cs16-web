#include <emscripten.h>
#include <stdio.h>

// Test function pointer storage
static void (*sendto_callback)(int, int, int) = NULL;
static void (*recvfrom_callback)(int, int, int, int, int, int) = NULL;

// Test functions that can be called from JavaScript
EMSCRIPTEN_KEEPALIVE
void register_sendto_callback(void (*callback)(int, int, int)) {
    sendto_callback = callback;
    printf("Sendto callback registered: %p\n", (void*)callback);
}

EMSCRIPTEN_KEEPALIVE
void register_recvfrom_callback(void (*callback)(int, int, int, int, int, int)) {
    recvfrom_callback = callback;
    printf("Recvfrom callback registered: %p\n", (void*)callback);
}

EMSCRIPTEN_KEEPALIVE
void test_sendto_callback() {
    if (sendto_callback) {
        printf("Calling sendto callback...\n");
        sendto_callback(123, 456, 0);
    } else {
        printf("No sendto callback registered\n");
    }
}

EMSCRIPTEN_KEEPALIVE
void test_recvfrom_callback() {
    if (recvfrom_callback) {
        printf("Calling recvfrom callback...\n");
        recvfrom_callback(1, 2, 3, 4, 5, 6);
    } else {
        printf("No recvfrom callback registered\n");
    }
}

int main() {
    printf("Test module initialized\n");
    return 0;
}
