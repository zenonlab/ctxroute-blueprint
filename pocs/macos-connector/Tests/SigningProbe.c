#ifndef PROBE_VARIANT
#error Define a distinct binary variant for the signature test
#endif
int main(void) { return PROBE_VARIANT; }
