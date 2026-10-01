# Progresión de ColonyMAXAI: de campamento a civilización

Documento de diseño y estado de la ampliación (campamento → aldea → pueblo → ciudad →
civilización). Todo lo que dice «Hecho» está implementado y probado; lo demás figura como
pendiente. Las reglas viven en datos (`src/sim/*.js`) para que construir, producir, mejorar y
reclutar compartan los mismos requisitos, y las valida la simulación del servidor.

## 1. Diagnóstico de lo que había

| Sistema | Estado inicial |
|---|---|
| Edades | 5 con nombre (Primitiva, Tribal, Bronce, Hierro, Medieval); sólo se llegaba a la II; III–V eran «próximamente». Se avanzaba mejorando 3 edificios. |
| Edificios | 5 tipos (recolección, tala, cantera, pozo, almacén), 2 niveles; un trabajador por edificio; sin procesado ni recetas. |
| Recursos | 5 en bruto (comida, agua, madera, piedra, fibras). |
| Colonos | Sim determinista, IA de utilidad, necesidades, genes, familia (reproducción emergente). Vestimenta única. |
| Vivienda | Tiendas del campamento; chozas añadidas hace poco (2 niveles). |
| Territorio | Radio fijo alrededor de la fogata. |
| Servicios / energía / transporte / ejército | No existían. |
| Red / persistencia | Servidor autoritativo con SQLite; la copia del navegador sólo refleja. |

## 2. Fases

| Fase | Contenido | Depende de | Complejidad |
|---|---|---|---|
| F1 | Base de progresión: 11 edades, catálogo de recursos y de edificios con requisitos, reglas centrales, guardado v3 y migración | — | Alta |
| F2 | Evolución automática: viviendas por edad, vestimenta y oficios de los colonos, centro del asentamiento | F1 | Media |
| F3 | Mejoras manuales: niveles por edificio, varios trabajadores, herramientas requeridas, equipos | F1 | Alta |
| F4 | Población y expansión: llegada de colonos, viviendas de más capacidad, territorio ampliable, umbrales de servicios, transición entre edades | F1–F3 | Media |
| F5 | Cadenas productivas y servicios: recetas, energía, caminos y transporte, mercado, investigación, hospital, escuela | F1, F3 | Muy alta |
| F6 | Ejército y defensas: unidades, reclutamiento, equipo, mantenimiento, defensas, incursiones, reglas de combate entre jugadores | F3, F4, F5 | Alta |
| F7 | Edades avanzadas (VII–X), rendimiento con aldeas grandes, Edad XI preparada | F1–F6 | Media |

Estado: ver la sección 8.

## 3. Tabla de edades

(Se completa con los datos definitivos del catálogo en la sección 8.)
