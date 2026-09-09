FROM emscripten/emsdk:4.0.23

WORKDIR /xash3d-fwgs
COPY xash3d-fwgs .
ENV EMCC_CFLAGS="-s USE_SDL=2"
RUN emconfigure ./waf configure --emscripten && \
	emmake ./waf build && \
    emmake ./waf install --destdir ./out
RUN mv ./out/xash.js ./out/raw.js

ENTRYPOINT ["cp", "-r", "/xash3d-fwgs/out/.", "/out/"]