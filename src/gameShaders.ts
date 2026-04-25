/**
 * src/gameShaders.ts
 * ASTRA INFINITUM — All GLSL shader source strings
 * (Named gameShaders to avoid macOS case-sensitivity conflict)
 */

// ── Earth Surface ───────────────────────────────────────────────────────────
export const earthVertexShader = /* glsl */`
  varying vec3 vNormal;
  varying vec3 vPosition;
  varying vec2 vUv;
  void main() {
    vNormal   = normalize(normalMatrix * normal);
    vPosition = (modelMatrix * vec4(position, 1.0)).xyz;
    vUv       = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const earthFragmentShader = /* glsl */`
  uniform vec3  uSunDir;
  uniform float uTime;
  varying vec3  vNormal;
  varying vec3  vPosition;
  varying vec2  vUv;

  vec3 mod289v3(vec3 x){ return x - floor(x*(1./289.))*289.; }
  vec4 mod289v4(vec4 x){ return x - floor(x*(1./289.))*289.; }
  vec4 permute(vec4 x){ return mod289v4(((x*34.)+1.)*x); }
  vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314*r; }

  float snoise(vec3 v) {
    const vec2 C = vec2(1./6., 1./3.);
    const vec4 D = vec4(0.,0.5,1.,2.);
    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g  = step(x0.yzx, x0.xyz);
    vec3 l  = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289v3(i);
    vec4 p  = permute(permute(permute(
      i.z + vec4(0.,i1.z,i2.z,1.))
      + i.y + vec4(0.,i1.y,i2.y,1.))
      + i.x + vec4(0.,i1.x,i2.x,1.));
    float n_ = 0.142857142857;
    vec3  ns = n_ * D.wyz - D.xzx;
    vec4 j   = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_  = floor(j * ns.z);
    vec4 y_  = floor(j - 7.0 * x_);
    vec4 x   = x_*ns.x + ns.yyyy;
    vec4 y   = y_*ns.x + ns.yyyy;
    vec4 h   = 1.0 - abs(x) - abs(y);
    vec4 b0  = vec4(x.xy, y.xy);
    vec4 b1  = vec4(x.zw, y.zw);
    vec4 s0  = floor(b0)*2.0+1.0;
    vec4 s1  = floor(b1)*2.0+1.0;
    vec4 sh  = -step(h, vec4(0.));
    vec4 a0  = b0.xzyw + s0.xzyw*sh.xxyy;
    vec4 a1  = b1.xzyw + s1.xzyw*sh.zzww;
    vec3 p0  = vec3(a0.xy,h.x);
    vec3 p1  = vec3(a0.zw,h.y);
    vec3 p2  = vec3(a1.xy,h.z);
    vec3 p3  = vec3(a1.zw,h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
    p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
    vec4 m  = max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.);
    m = m*m;
    return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
  }

  float fbm(vec3 p, int oct) {
    float v=0.,a=0.5,f=1.;
    for(int i=0;i<8;i++){
      if(i>=oct) break;
      v+=a*snoise(p*f); f*=2.01; a*=0.5;
    }
    return v;
  }

  void main() {
    vec3 sp = normalize(vPosition);
    float lon = atan(sp.z, sp.x) + uTime*0.0001;
    float lat = asin(sp.y);
    vec3 coord = vec3(cos(lat)*cos(lon), cos(lat)*sin(lon), sp.y);

    float elev = fbm(coord*3.5,7)*0.5+0.5;
    float shore = fbm(coord*6.0,5)*0.3;
    float landMask = smoothstep(0.48,0.56,elev+shore*0.15);

    vec3 ocean = mix(vec3(0.02,0.08,0.22), vec3(0.05,0.26,0.42), fbm(coord*8.,4)*0.5+0.5);
    vec3 land  = mix(vec3(0.12,0.28,0.08), vec3(0.26,0.20,0.10), smoothstep(0.55,0.75,elev));
    land = mix(land, vec3(0.88,0.91,0.95), smoothstep(0.80,0.95,elev)+smoothstep(0.75,0.95,abs(sp.y)));
    vec3 surface = mix(ocean, land, landMask);

    float NdotL  = max(dot(vNormal,normalize(uSunDir)),0.0);
    float nightMask = 1.0-smoothstep(0.0,0.15,NdotL);
    vec3 cityLights = vec3(1.0,0.85,0.5)*landMask*nightMask*smoothstep(0.55,0.72,fbm(coord*18.,4))*1.2;
    vec3 color = surface*(0.04+NdotL)+cityLights;

    vec3 viewDir=normalize(-vPosition);
    vec3 halfV=normalize(normalize(uSunDir)+viewDir);
    float spec=pow(max(dot(vNormal,halfV),0.0),64.0);
    color += (1.0-landMask)*spec*vec3(0.8,0.9,1.0)*NdotL;
    gl_FragColor = vec4(color,1.0);
  }
`;

// ── Atmosphere (Rayleigh + Mie) ─────────────────────────────────────────────
export const atmosphereVertexShader = /* glsl */`
  varying vec3 vPosition;
  varying vec3 vNormal;
  void main() {
    vNormal   = normalize(normalMatrix * normal);
    vPosition = (modelMatrix * vec4(position,1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
  }
`;

export const atmosphereFragmentShader = /* glsl */`
  uniform vec3  uSunDir;
  uniform vec3  uCameraPos;
  uniform float uAtmRadius;
  uniform float uEarthRadius;
  varying vec3  vPosition;
  varying vec3  vNormal;
  const vec3 BETA_R = vec3(5.8e-6,13.5e-6,33.1e-6);
  void main() {
    vec3 sunDir=normalize(uSunDir);
    vec3 viewDir=normalize(vPosition-uCameraPos);
    float cosAngle=dot(viewDir,vNormal);
    float NdotL=max(dot(vNormal,sunDir),0.0);
    float altitude=(length(vPosition)-uEarthRadius)/(uAtmRadius-uEarthRadius);
    float density=exp(-altitude*8.0);
    float cosTheta=dot(-viewDir,sunDir);
    float phaseR=(3.0/(16.0*3.14159))*(1.0+cosTheta*cosTheta);
    float phaseM=(3.0/(8.0*3.14159))*((1.0-0.76*0.76)*(1.0+cosTheta*cosTheta))
                 /((2.0+0.76*0.76)*pow(1.0+0.76*0.76-2.0*0.76*cosTheta,1.5));
    vec3 scatter=BETA_R*phaseR*density*NdotL*20.0+vec3(21e-6)*phaseM*exp(-altitude*15.0)*NdotL*8.0;
    float rim=pow(max(1.0-abs(cosAngle),0.0),3.0);
    float alpha=density*rim*1.2+length(scatter)*0.4;
    gl_FragColor=vec4(scatter+vec3(0.1,0.18,0.35)*rim*density, clamp(alpha,0.0,0.95));
  }
`;

// ── Starfield ───────────────────────────────────────────────────────────────
export const starVertexShader = /* glsl */`
  attribute float aSize;
  attribute float aBrightness;
  attribute vec3  aColor;
  uniform   float uStreak;
  varying   float vBright;
  varying   vec3  vColor;
  void main() {
    vBright=aBrightness; vColor=aColor;
    vec4 mvPos=modelViewMatrix*vec4(position,1.0);
    gl_PointSize=aSize*(1.0+uStreak*4.0)*(300.0/-mvPos.z);
    gl_Position=projectionMatrix*mvPos;
  }
`;

export const starFragmentShader = /* glsl */`
  uniform float uStreak;
  varying float vBright;
  varying vec3  vColor;
  void main() {
    vec2 uv=gl_PointCoord-0.5;
    float sd=length(vec2(uv.x, uv.y/(1.0+uStreak*12.0)));
    float alpha=smoothstep(0.5,0.0,sd)*vBright;
    gl_FragColor=vec4(vColor*(1.0+uStreak*2.0),alpha);
  }
`;

// ── Sun Billboard ────────────────────────────────────────────────────────────
export const sunVertexShader = /* glsl */`
  varying vec2 vUv;
  void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }
`;

export const sunFragmentShader = /* glsl */`
  uniform float uTime;
  varying vec2  vUv;
  float hsh(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  float nse(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hsh(i),hsh(i+vec2(1,0)),f.x),mix(hsh(i+vec2(0,1)),hsh(i+vec2(1,1)),f.x),f.y);}
  void main(){
    vec2 uv=vUv-0.5; float d=length(uv); float n=nse(uv*4.0+uTime*0.05);
    float core=exp(-d*d*12.0); float corona=exp(-d*d*2.5)*(0.6+0.4*n); float flare=exp(-d*d*0.4)*0.3;
    vec3 col=vec3(1.0,0.85,0.35)*core+vec3(1.0,0.60,0.10)*corona+vec3(1.0,0.40,0.05)*flare;
    gl_FragColor=vec4(col, clamp(core+corona+flare,0.0,1.0));
  }
`;

// ── ISS Hull ─────────────────────────────────────────────────────────────────
export const issVertexShader = /* glsl */`
  varying vec3 vNormal; varying vec3 vPosition;
  void main(){
    vNormal=normalize(normalMatrix*normal);
    vPosition=(modelMatrix*vec4(position,1.0)).xyz;
    gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
  }
`;

export const issFragmentShader = /* glsl */`
  uniform vec3 uSunDir; uniform float uTime;
  varying vec3 vNormal; varying vec3 vPosition;
  void main(){
    vec3 sun=normalize(uSunDir);
    float diff=max(dot(vNormal,sun),0.0);
    vec3 halfV=normalize(sun+normalize(-vPosition));
    float spec=pow(max(dot(vNormal,halfV),0.0),120.0);
    vec3 col=vec3(0.78,0.82,0.88)*(0.12+diff)+vec3(1.0)*spec*0.8;
    col+=vec3(1.0,0.2,0.1)*step(0.5,fract(uTime*0.8))*0.15;
    gl_FragColor=vec4(col,1.0);
  }
`;

// ── Planet Terrain ────────────────────────────────────────────────────────────
export const planetVertexShader = /* glsl */`
  attribute float aElevation;
  varying   float vElevation;
  varying   vec3  vNormal;
  varying   vec3  vPosition;
  void main(){
    vElevation=aElevation;
    vNormal=normalize(normalMatrix*normal);
    vPosition=(modelMatrix*vec4(position,1.0)).xyz;
    gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
  }
`;

export const planetFragmentShader = /* glsl */`
  uniform vec3 uSunDir,uLowColor,uHighColor,uSnowColor;
  varying float vElevation; varying vec3 vNormal,vPosition;
  void main(){
    float e=clamp(vElevation,0.0,1.0);
    vec3 surf=mix(uLowColor,uHighColor,smoothstep(0.3,0.7,e));
    surf=mix(surf,uSnowColor,smoothstep(0.78,0.95,e));
    float NdotL=max(dot(vNormal,normalize(uSunDir)),0.0);
    gl_FragColor=vec4(surf*(0.08+NdotL),1.0);
  }
`;

// ── Engine Plume ──────────────────────────────────────────────────────────────
export const plumeVertexShader = /* glsl */`
  attribute float aLife; attribute float aSize;
  uniform float uTime,uPressure;
  varying float vLife,vPressure;
  void main(){
    vLife=aLife; vPressure=uPressure;
    vec4 mvPos=modelViewMatrix*vec4(position,1.0);
    gl_PointSize=aSize*(1.0+(1.0-uPressure)*4.0)*(600.0/-mvPos.z);
    gl_Position=projectionMatrix*mvPos;
  }
`;

export const plumeFragmentShader = /* glsl */`
  varying float vLife,vPressure;
  void main(){
    float d=length(gl_PointCoord-0.5);
    float a=smoothstep(0.5,0.0,d)*vLife*(1.0+(1.0-vPressure)*2.0);
    vec3 col=mix(vec3(0.6,0.8,1.0),vec3(1.0,0.95,0.7),vLife);
    gl_FragColor=vec4(col,clamp(a,0.0,1.0));
  }
`;
