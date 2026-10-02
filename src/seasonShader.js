// Estaciones que se ven: el color de la vegetación, la nieve y los árboles sin hojas se calculan en
// la tarjeta gráfica a partir de la fecha del mundo (un solo número, "uYear") y de la latitud de cada
// punto. Cambiar de estación no regenera nada: ni terreno, ni recursos. La misma fórmula que
// sim/calendar.js (seasonAt) para que lo que se ve coincida con lo que simula el servidor.

import * as THREE from 'three';

// uYear: avance del año (0..1, 0 = equinoccio de primavera del norte). Lo actualiza main.js cada fotograma
// con la fecha del servidor, no con el reloj de la máquina.
export const seasonUniforms = {
  uYear: { value: 0.1 },
  uSeasonOn: { value: 1 },
};

// Funciones GLSL comunes. TAU y las constantes de calendar.js: retraso del calor 0,11, retraso del monzón 0,02.
export const SEASON_GLSL = /* glsl */ `
  uniform float uYear;
  uniform float uSeasonOn;
  const float S_TAU = 6.2831853;
  // Cuánto cambian las estaciones en esa latitud (0 en el ecuador, 1 en latitudes medias).
  float seasonAmp(float sinLat) {
    return smoothstep(0.0524, 0.7854, abs(asin(clamp(sinLat, -1.0, 1.0))));
  }
  // -1 (lo más frío del año en ese lugar) .. +1 (lo más cálido).
  float seasonWarmth(float sinLat) {
    float north = sinLat >= 0.0 ? 1.0 : -1.0;
    return seasonAmp(sinLat) * north * sin(S_TAU * (uYear - 0.11));
  }
  // Positivo si se está calentando (primavera), negativo si se enfría (otoño).
  float seasonTrend(float sinLat) {
    float north = sinLat >= 0.0 ? 1.0 : -1.0;
    return north * cos(S_TAU * (uYear - 0.11));
  }
  // Ausencia de lluvias en los trópicos (0 húmedo .. 1 seco).
  float tropicDryness(float sinLat) {
    float a = abs(asin(clamp(sinLat, -1.0, 1.0)));
    float north = sinLat >= 0.0 ? 1.0 : -1.0;
    float monsoon = north * sin(S_TAU * (uYear - 0.02));
    return (1.0 - smoothstep(0.35, 0.52, a)) * smoothstep(0.017, 0.157, a) * smoothstep(0.1, -0.8, monsoon);
  }
  // Cuánta vegetación verde tiene un color (para teñir sólo lo verde).
  float greenness(vec3 c) {
    return clamp((c.g - max(c.r, c.b)) * 7.0, 0.0, 1.0);
  }
  // Tiñe lo verde según la estación: otoño anaranjado, invierno pardo, sequía amarillenta.
  vec3 seasonTint(vec3 c, float sinLat, float deciduous) {
    float amp = seasonAmp(sinLat);
    float w = seasonWarmth(sinLat);
    float trend = seasonTrend(sinLat);
    float temperate = smoothstep(0.1, 0.45, amp);
    float cool = smoothstep(0.35, -0.55, w) * temperate;
    float deep = smoothstep(0.55, 0.95, cool);
    float veg = greenness(c);
    float luma = dot(c, vec3(0.3, 0.55, 0.15));
    // Otoño (enfriándose): hojas anaranjadas; invierno profundo: pardo apagado.
    float falling = smoothstep(0.2, -0.4, trend);
    vec3 autumn = mix(vec3(0.46, 0.21, 0.035), vec3(0.21, 0.15, 0.075), deep);
    float amount = veg * cool * deciduous * mix(0.55, 1.0, falling);
    vec3 out_ = mix(c, autumn * (0.55 + luma * 1.6), clamp(amount, 0.0, 0.92));
    // Lo perenne (pinos, selva) no cambia de color: sólo se apaga un poco con el frío.
    out_ *= 1.0 - 0.22 * cool * veg * (1.0 - deciduous);
    // Primavera: verde un poco más vivo.
    out_ += c * veg * temperate * smoothstep(-0.1, 0.9, trend) * smoothstep(0.2, -0.6, w) * 0.18;
    // Época seca tropical: la vegetación amarillea.
    out_ = mix(out_, vec3(0.32, 0.25, 0.08) * (0.7 + luma), veg * tropicDryness(sinLat) * 0.5);
    return out_;
  }
`;

// Prepara un material para que use las estaciones (se llama dentro de onBeforeCompile).
export function bindSeasonUniforms(shader) {
  shader.uniforms.uYear = seasonUniforms.uYear;
  shader.uniforms.uSeasonOn = seasonUniforms.uSeasonOn;
}

// Fija la fecha que se ve (phase del calendario).
export function setSeasonPhase(phase) {
  seasonUniforms.uYear.value = THREE.MathUtils.euclideanModulo(phase, 1);
}
