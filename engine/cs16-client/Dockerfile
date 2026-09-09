FROM emscripten/emsdk:4.0.17

WORKDIR /cs
COPY cs16-client .
RUN emcmake cmake -S . -B build -DCMAKE_INSTALL_PREFIX=./out && \
    cmake --build build --config Release --target install


ENTRYPOINT ["cp", "-r", "/cs/out/.", "/out/"]