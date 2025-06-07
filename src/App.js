import React, { useState, useCallback } from 'react';
import { Target, Database, Brain, RefreshCw, CheckCircle2, BarChart3, FileDown, Bot, Upload, Settings, Zap, Gauge } from 'lucide-react';
import './App.css';

// ==================== CONFIGURACIÓN Y CONSTANTES ====================

const PROGOL_CONFIG = {
  DISTRIBUCION_HISTORICA: { L: 0.38, E: 0.29, V: 0.33 },
  RANGOS_HISTORICOS: {
    L: [0.35, 0.41],
    E: [0.25, 0.33], 
    V: [0.30, 0.36]
  },
  EMPATES_PROMEDIO: 4.33,
  EMPATES_MIN: 4,
  EMPATES_MAX: 6,
  CONCENTRACION_MAX_GENERAL: 0.70,
  CONCENTRACION_MAX_INICIAL: 0.60,
  CALIBRACION: {
    k1_forma: 0.15,
    k2_lesiones: 0.10,
    k3_contexto: 0.20
  },
  DRAW_PROPENSITY: {
    umbral_diferencia: 0.08,
    boost_empate: 0.06
  }
};

// ==================== UTILIDADES MATEMÁTICAS ====================

class MathUtils {
  static poissonProbability(k, lambda) {
    if (lambda === 0) return k === 0 ? 1 : 0;
    let result = Math.exp(-lambda);
    for (let i = 1; i <= k; i++) {
      result = result * lambda / i;
    }
    return result;
  }

  static binomialCoeff(n, k) {
    if (k > n) return 0;
    if (k === 0 || k === n) return 1;
    
    let result = 1;
    for (let i = 0; i < Math.min(k, n - k); i++) {
      result = result * (n - i) / (i + 1);
    }
    return result;
  }

  static calculateProb11PlusExact(probabilities) {
    const n = probabilities.length;
    const dp = Array(n + 1).fill(0).map(() => Array(15).fill(0));
    
    // Caso base
    dp[0][0] = 1;
    
    // Llenar la tabla DP
    for (let i = 1; i <= n; i++) {
      const p = probabilities[i - 1];
      for (let j = 0; j <= Math.min(i, 14); j++) {
        // No acierta
        dp[i][j] += dp[i-1][j] * (1 - p);
        // Acierta
        if (j > 0) {
          dp[i][j] += dp[i-1][j-1] * p;
        }
      }
    }
    
    // Sumar probabilidades de 11 o más aciertos
    let prob11Plus = 0;
    for (let j = 11; j <= 14; j++) {
      prob11Plus += dp[n][j];
    }
    
    return prob11Plus;
  }
}

// ==================== CLASIFICADOR DE PARTIDOS MEJORADO ====================

class MatchClassifier {
  constructor() {
    this.umbralAncla = 0.60;
    this.umbralDivisorMin = 0.40;
    this.umbralDivisorMax = 0.60;
    this.umbralEmpate = 0.25;
  }

  classifyMatches(partidos) {
    return partidos.map((partido, i) => {
      const partidoCalirado = this.aplicarCalibracionBayesiana(partido);
      const clasificacion = this.clasificarPartido(partidoCalirado);
      
      return {
        id: i,
        local: partido.local,
        visitante: partido.visitante,
        ...partidoCalirado,
        clasificacion,
        resultadoSugerido: this.getResultadoSugerido(partidoCalirado),
        confianza: this.calcularConfianza(partidoCalirado),
        volatilidad: this.calcularVolatilidad(partidoCalirado)
      };
    });
  }

  aplicarCalibracionBayesiana(partido) {
    const { k1_forma, k2_lesiones, k3_contexto } = PROGOL_CONFIG.CALIBRACION;
    
    const deltaForma = partido.forma_diferencia || 0;
    const lesionesImpact = partido.lesiones_impact || 0;
    const contexto = partido.es_final ? 1.0 : 0.0;
    
    // Factor de ajuste más conservador
    const factorForma = 1 + k1_forma * Math.tanh(deltaForma / 2);
    const factorLesiones = 1 + k2_lesiones * Math.tanh(lesionesImpact / 2);
    const factorContexto = 1 + k3_contexto * contexto;
    
    let probLocal = partido.prob_local * factorForma * factorLesiones * factorContexto;
    let probEmpate = partido.prob_empate;
    let probVisitante = partido.prob_visitante / (factorForma * factorLesiones * Math.max(factorContexto, 0.5));
    
    // Aplicar Draw-Propensity Rule de manera más sutil
    const diferencia = Math.abs(probLocal - probVisitante);
    if (diferencia < PROGOL_CONFIG.DRAW_PROPENSITY.umbral_diferencia) {
      const maxPrincipal = Math.max(probLocal, probVisitante);
      if (probEmpate >= maxPrincipal * 0.8) {
        probEmpate = Math.min(probEmpate * 1.15, 0.90);
      }
    }
    
    // Renormalizar
    const total = probLocal + probEmpate + probVisitante;
    
    return {
      prob_local: probLocal / total,
      prob_empate: probEmpate / total,
      prob_visitante: probVisitante / total
    };
  }

  clasificarPartido(partido) {
    const probs = [partido.prob_local, partido.prob_empate, partido.prob_visitante];
    const maxProb = Math.max(...probs);
    const secondMaxProb = probs.sort((a, b) => b - a)[1];
    
    // Clasificación más granular
    if (maxProb > this.umbralAncla && (maxProb - secondMaxProb) > 0.20) {
      return 'Ancla';
    }
    
    if (partido.prob_empate > this.umbralEmpate && 
        partido.prob_empate >= Math.max(partido.prob_local, partido.prob_visitante) * 0.85) {
      return 'TendenciaEmpate';
    }
    
    if (maxProb >= this.umbralDivisorMin && maxProb < this.umbralDivisorMax) {
      return 'Divisor';
    }
    
    if ((maxProb - secondMaxProb) < 0.15) {
      return 'Volátil';
    }
    
    return 'Neutro';
  }

  getResultadoSugerido(partido) {
    const probs = {
      L: partido.prob_local,
      E: partido.prob_empate,
      V: partido.prob_visitante
    };
    return Object.keys(probs).reduce((a, b) => probs[a] > probs[b] ? a : b);
  }

  calcularConfianza(partido) {
    const probs = [partido.prob_local, partido.prob_empate, partido.prob_visitante];
    probs.sort((a, b) => b - a);
    return probs[0] - probs[1];
  }

  calcularVolatilidad(partido) {
    const entropy = -[partido.prob_local, partido.prob_empate, partido.prob_visitante]
      .map(p => p > 0 ? p * Math.log2(p) : 0)
      .reduce((a, b) => a + b, 0);
    return entropy / Math.log2(3); // Normalizado entre 0 y 1
  }
}

// ==================== GENERADOR DE PORTAFOLIO MEJORADO ====================

class PortfolioGenerator {
  constructor(seed = 42, config = {}) {
    this.seed = seed;
    this.rng = this.createSeededRandom(seed);
    this.config = {
      iteracionesOptimizador: 2000,
      temperaturaInicial: 0.50,
      tasaEnfriamiento: 0.998,
      simulacionesMonteCarlo: 3000,
      ...config
    };
  }

  createSeededRandom(seed) {
    let state = seed;
    return () => {
      state = (state * 1664525 + 1013904223) % 4294967296;
      return state / 4294967296;
    };
  }

  generateCoreQuinielas(partidosClasificados) {
    const coreQuinielas = [];
    
    // Generar 4 quinielas Core con variaciones controladas
    for (let i = 0; i < 4; i++) {
      let quiniela = this.crearQuinielaBase(partidosClasificados);
      
      // Aplicar variaciones específicas para cada Core
      if (i === 1) {
        // Core-2: Más conservador en empates
        quiniela = this.aplicarVariacionConservadora(quiniela, partidosClasificados);
      } else if (i === 2) {
        // Core-3: Más agresivo en favoritos
        quiniela = this.aplicarVariacionAgresiva(quiniela, partidosClasificados);
      } else if (i === 3) {
        // Core-4: Balance con tendencia a empates fuertes
        quiniela = this.aplicarVariacionEquilibrada(quiniela, partidosClasificados);
      }
      
      quiniela = this.ajustarEmpates(quiniela, partidosClasificados);
      
      const quinielaObj = {
        id: `Core-${i + 1}`,
        tipo: 'Core',
        resultados: quiniela,
        empates: quiniela.filter(r => r === 'E').length,
        prob_11_plus: this.calcularProb11Plus(quiniela, partidosClasificados),
        distribucion: this.calcularDistribucion(quiniela),
        variacion: i === 0 ? 'Base' : i === 1 ? 'Conservadora' : i === 2 ? 'Agresiva' : 'Equilibrada'
      };
      
      coreQuinielas.push(quinielaObj);
    }
    
    return coreQuinielas;
  }

  crearQuinielaBase(partidosClasificados) {
    const quiniela = [];
    let empatesActuales = 0;
    
    for (const partido of partidosClasificados) {
      let resultado;
      
      if (partido.clasificacion === 'Ancla') {
        resultado = partido.resultadoSugerido;
      } else if (partido.clasificacion === 'TendenciaEmpate' && empatesActuales < PROGOL_CONFIG.EMPATES_MAX) {
        resultado = 'E';
        empatesActuales++;
      } else {
        resultado = partido.resultadoSugerido;
      }
      
      if (resultado === 'E') empatesActuales++;
      quiniela.push(resultado);
    }
    
    return quiniela;
  }

  aplicarVariacionConservadora(quiniela, partidosClasificados) {
    const quinielaVariada = [...quiniela];
    
    for (let i = 0; i < partidosClasificados.length; i++) {
      const partido = partidosClasificados[i];
      if (partido.clasificacion === 'Divisor' && partido.prob_empate > 0.25) {
        if (this.rng() < 0.4) {
          quinielaVariada[i] = 'E';
        }
      }
    }
    
    return quinielaVariada;
  }

  aplicarVariacionAgresiva(quiniela, partidosClasificados) {
    const quinielaVariada = [...quiniela];
    
    for (let i = 0; i < partidosClasificados.length; i++) {
      const partido = partidosClasificados[i];
      if (partido.clasificacion === 'Divisor' && partido.confianza > 0.15) {
        quinielaVariada[i] = partido.resultadoSugerido;
      }
    }
    
    return quinielaVariada;
  }

  aplicarVariacionEquilibrada(quiniela, partidosClasificados) {
    const quinielaVariada = [...quiniela];
    
    for (let i = 0; i < partidosClasificados.length; i++) {
      const partido = partidosClasificados[i];
      if (partido.clasificacion === 'Volátil' || partido.clasificacion === 'Neutro') {
        if (this.rng() < 0.35) {
          const alternativas = this.getAlternativasOrdenadas(partido);
          quinielaVariada[i] = alternativas[1].resultado; // Segunda opción
        }
      }
    }
    
    return quinielaVariada;
  }

  generateSatelliteQuinielas(partidosClasificados, quinielasCore, numSatelites) {
    const satelites = [];
    
    // Identificar partidos estratégicos para diversificación
    const partidosDivisor = partidosClasificados
      .map((p, i) => ({ ...p, index: i }))
      .filter(p => ['Divisor', 'Volátil', 'TendenciaEmpate'].includes(p.clasificacion))
      .sort((a, b) => b.volatilidad - a.volatilidad);
    
    const numPares = Math.floor(numSatelites / 2);
    
    // Generar pares anticorrelacionados
    for (let par = 0; par < numPares; par++) {
      const [satA, satB] = this.crearParAnticorrelacionado(
        partidosClasificados,
        partidosDivisor,
        quinielasCore,
        par
      );
      satelites.push(satA, satB);
    }
    
    // Si número impar, crear uno adicional con máxima diversidad
    if (numSatelites % 2 === 1) {
      const satExtra = this.crearSateliteMaximaDiversidad(
        partidosClasificados, 
        [...quinielasCore, ...satelites],
        satelites.length
      );
      satelites.push(satExtra);
    }
    
    return satelites;
  }

  crearParAnticorrelacionado(partidosClasificados, partidosDiversos, quinielasCore, parId) {
    // Seleccionar múltiples partidos para crear anticorrelación
    const numPartidosDiversificar = Math.min(3, partidosDiversos.length);
    const partidosTarget = [];
    
    for (let i = 0; i < numPartidosDiversificar; i++) {
      const idx = (parId * numPartidosDiversificar + i) % partidosDiversos.length;
      partidosTarget.push(partidosDiversos[idx].index);
    }
    
    const quinielaA = [];
    const quinielaB = [];
    
    for (let i = 0; i < partidosClasificados.length; i++) {
      const partido = partidosClasificados[i];
      
      if (partidosTarget.includes(i)) {
        // Crear anticorrelación sistemática
        const alternativas = this.getAlternativasOrdenadas(partido);
        quinielaA.push(alternativas[0].resultado); // Primera opción
        quinielaB.push(alternativas[1].resultado); // Segunda opción
      } else if (partido.clasificacion === 'Ancla') {
        // Mantener anclas fijas
        const resultado = partido.resultadoSugerido;
        quinielaA.push(resultado);
        quinielaB.push(resultado);
      } else {
        // Variación controlada en otros partidos
        const prob = this.rng();
        if (prob < 0.3) {
          const alternativas = this.getAlternativasOrdenadas(partido);
          quinielaA.push(alternativas[0].resultado);
          quinielaB.push(alternativas[Math.min(2, alternativas.length - 1)].resultado);
        } else {
          const resultado = partido.resultadoSugerido;
          quinielaA.push(resultado);
          quinielaB.push(resultado);
        }
      }
    }
    
    const satA = {
      id: `Sat-${parId * 2 + 1}A`,
      tipo: 'Satelite',
      resultados: this.ajustarEmpates(quinielaA, partidosClasificados),
      par_id: parId,
      diversidad_target: partidosTarget
    };
    
    const satB = {
      id: `Sat-${parId * 2 + 1}B`,
      tipo: 'Satelite', 
      resultados: this.ajustarEmpates(quinielaB, partidosClasificados),
      par_id: parId,
      diversidad_target: partidosTarget
    };
    
    // Calcular métricas
    [satA, satB].forEach(sat => {
      sat.empates = sat.resultados.filter(r => r === 'E').length;
      sat.prob_11_plus = this.calcularProb11Plus(sat.resultados, partidosClasificados);
      sat.distribucion = this.calcularDistribucion(sat.resultados);
      sat.correlacion_par = this.calcularCorrelacion(satA.resultados, satB.resultados);
    });
    
    return [satA, satB];
  }

  crearSateliteMaximaDiversidad(partidosClasificados, quinielasExistentes, sateliteId) {
    let mejorQuiniela = null;
    let mejorDiversidad = -1;
    
    // Intentar múltiples variaciones y seleccionar la más diversa
    for (let intento = 0; intento < 50; intento++) {
      let quiniela = this.crearQuinielaBase(partidosClasificados);
      
      // Aplicar variación aleatoria controlada
      for (let i = 0; i < partidosClasificados.length; i++) {
        const partido = partidosClasificados[i];
        if (partido.clasificacion !== 'Ancla' && this.rng() < 0.6) {
          const alternativas = this.getAlternativasOrdenadas(partido);
          const idx = Math.floor(this.rng() * alternativas.length);
          quiniela[i] = alternativas[idx].resultado;
        }
      }
      
      quiniela = this.ajustarEmpates(quiniela, partidosClasificados);
      
      const diversidad = this.calcularDiversidadRespecto(quiniela, quinielasExistentes);
      
      if (diversidad > mejorDiversidad) {
        mejorDiversidad = diversidad;
        mejorQuiniela = quiniela;
      }
    }
    
    return {
      id: `Sat-${sateliteId + 1}`,
      tipo: 'Satelite',
      resultados: mejorQuiniela,
      empates: mejorQuiniela.filter(r => r === 'E').length,
      prob_11_plus: this.calcularProb11Plus(mejorQuiniela, partidosClasificados),
      distribucion: this.calcularDistribucion(mejorQuiniela),
      par_id: null,
      diversidad_score: mejorDiversidad
    };
  }

  getAlternativasOrdenadas(partido) {
    const alternativas = [
      { resultado: 'L', prob: partido.prob_local },
      { resultado: 'E', prob: partido.prob_empate },
      { resultado: 'V', prob: partido.prob_visitante }
    ];
    
    return alternativas.sort((a, b) => b.prob - a.prob);
  }

  calcularCorrelacion(q1, q2) {
    const vectorizar = (q) => q.map(r => r === 'L' ? 1 : r === 'E' ? 0 : -1);
    const v1 = vectorizar(q1);
    const v2 = vectorizar(q2);
    
    const media1 = v1.reduce((a, b) => a + b) / v1.length;
    const media2 = v2.reduce((a, b) => a + b) / v2.length;
    
    let num = 0, den1 = 0, den2 = 0;
    
    for (let i = 0; i < v1.length; i++) {
      const diff1 = v1[i] - media1;
      const diff2 = v2[i] - media2;
      num += diff1 * diff2;
      den1 += diff1 * diff1;
      den2 += diff2 * diff2;
    }
    
    const denominador = Math.sqrt(den1 * den2);
    return denominador === 0 ? 0 : num / denominador;
  }

  calcularDiversidadRespecto(quiniela, quinielasExistentes) {
    if (quinielasExistentes.length === 0) return 1;
    
    let diversidadTotal = 0;
    
    for (const existente of quinielasExistentes) {
      const distancia = this.calcularDistanciaHamming(quiniela, existente.resultados);
      diversidadTotal += distancia / 14; // Normalizar
    }
    
    return diversidadTotal / quinielasExistentes.length;
  }

  calcularDistanciaHamming(q1, q2) {
    return q1.reduce((acc, val, i) => acc + (val !== q2[i] ? 1 : 0), 0);
  }

  ajustarEmpates(quiniela, partidosClasificados) {
    const empatesActuales = quiniela.filter(r => r === 'E').length;
    const quinielaAjustada = [...quiniela];
    
    if (empatesActuales < PROGOL_CONFIG.EMPATES_MIN) {
      // Necesitamos más empates - buscar candidatos más probables
      const empatesNecesarios = PROGOL_CONFIG.EMPATES_MIN - empatesActuales;
      const candidatos = [];
      
      for (let i = 0; i < quinielaAjustada.length; i++) {
        if (quinielaAjustada[i] !== 'E' && 
            partidosClasificados[i].clasificacion !== 'Ancla' &&
            partidosClasificados[i].prob_empate > 0.20) {
          candidatos.push({ 
            index: i, 
            prob: partidosClasificados[i].prob_empate,
            confianza: partidosClasificados[i].confianza
          });
        }
      }
      
      // Ordenar por probabilidad de empate y menor confianza en el resultado actual
      candidatos.sort((a, b) => (b.prob - a.confianza) - (a.prob - a.confianza));
      
      for (let i = 0; i < Math.min(empatesNecesarios, candidatos.length); i++) {
        quinielaAjustada[candidatos[i].index] = 'E';
      }
    } else if (empatesActuales > PROGOL_CONFIG.EMPATES_MAX) {
      // Demasiados empates - remover los menos probables
      const empatesExceso = empatesActuales - PROGOL_CONFIG.EMPATES_MAX;
      const candidatosEmpate = [];
      
      for (let i = 0; i < quinielaAjustada.length; i++) {
        if (quinielaAjustada[i] === 'E' &&
            partidosClasificados[i].clasificacion !== 'TendenciaEmpate') {
          candidatosEmpate.push({ 
            index: i, 
            prob: partidosClasificados[i].prob_empate 
          });
        }
      }
      
      candidatosEmpate.sort((a, b) => a.prob - b.prob);
      
      for (let i = 0; i < Math.min(empatesExceso, candidatosEmpate.length); i++) {
        const idx = candidatosEmpate[i].index;
        quinielaAjustada[idx] = partidosClasificados[idx].resultadoSugerido;
      }
    }
    
    return quinielaAjustada;
  }

  calcularProb11Plus(quiniela, partidosClasificados) {
    const probsAcierto = [];
    
    for (let i = 0; i < quiniela.length; i++) {
      const resultado = quiniela[i];
      const partido = partidosClasificados[i];
      
      let prob;
      if (resultado === 'L') prob = partido.prob_local;
      else if (resultado === 'E') prob = partido.prob_empate;
      else prob = partido.prob_visitante;
      
      probsAcierto.push(Math.max(0.01, Math.min(0.99, prob))); // Clamp values
    }
    
    // Usar cálculo exacto para mejor precisión
    return MathUtils.calculateProb11PlusExact(probsAcierto);
  }

  calcularDistribucion(quiniela) {
    const total = quiniela.length;
    return {
      L: quiniela.filter(r => r === 'L').length / total,
      E: quiniela.filter(r => r === 'E').length / total,
      V: quiniela.filter(r => r === 'V').length / total
    };
  }

  // ==================== OPTIMIZACIÓN GRASP-ANNEALING MEJORADA ====================

  async optimizePortfolioGRASPAnnealing(quinielasIniciales, partidosClasificados, progressCallback) {
    const config = this.config;
    let quinielasActuales = [...quinielasIniciales];
    let mejorScore = this.evaluarPortafolio(quinielasActuales);
    let mejorPortafolio = quinielasActuales.map(q => ({ ...q, resultados: [...q.resultados] }));
    
    let temperatura = config.temperaturaInicial;
    const pasoReporte = Math.max(1, Math.floor(config.iteracionesOptimizador / 100));
    
    for (let iter = 0; iter < config.iteracionesOptimizador; iter++) {
      // Fase GRASP: Construcción golosa con randomización
      if (iter % 50 === 0) {
        quinielasActuales = this.faseGRASP(quinielasActuales, partidosClasificados);
      }
      
      // Fase Annealing: Mejora local
      const vecinoPortafolio = this.generarVecinoInteligente(quinielasActuales, partidosClasificados);
      const scoreVecino = this.evaluarPortafolio(vecinoPortafolio);
      
      const delta = scoreVecino - mejorScore;
      
      // Criterio de aceptación
      if (delta > 0 || this.rng() < Math.exp(delta / temperatura)) {
        quinielasActuales = vecinoPortafolio;
        
        if (scoreVecino > mejorScore) {
          mejorScore = scoreVecino;
          mejorPortafolio = vecinoPortafolio.map(q => ({ ...q, resultados: [...q.resultados] }));
        }
      }
      
      // Enfriamiento
      temperatura *= config.tasaEnfriamiento;
      
      // Reporte de progreso
      if (progressCallback && iter % pasoReporte === 0) {
        progressCallback({
          iteracion: iter,
          score: mejorScore,
          porcentaje: (iter / config.iteracionesOptimizador) * 100,
          temperatura: temperatura,
          mejorScore: mejorScore
        });
        
        // Yield control to allow UI updates
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    
    return mejorPortafolio;
  }

  faseGRASP(quinielasActuales, partidosClasificados) {
    // Reconstruir algunas quinielas usando construcción golosa
    const numReconstruir = Math.floor(quinielasActuales.length * 0.3);
    const quinielasModificadas = [...quinielasActuales];
    
    for (let i = 0; i < numReconstruir; i++) {
      const idx = Math.floor(this.rng() * quinielasModificadas.length);
      const nuevaQuiniela = this.construirQuinielaGolosa(partidosClasificados, quinielasModificadas);
      
      quinielasModificadas[idx] = {
        ...quinielasModificadas[idx],
        resultados: nuevaQuiniela,
        empates: nuevaQuiniela.filter(r => r === 'E').length,
        prob_11_plus: this.calcularProb11Plus(nuevaQuiniela, partidosClasificados),
        distribucion: this.calcularDistribucion(nuevaQuiniela)
      };
    }
    
    return quinielasModificadas;
  }

  construirQuinielaGolosa(partidosClasificados, quinielasExistentes) {
    const quiniela = [];
    const alpha = 0.3; // Parámetro de randomización GRASP
    
    for (let i = 0; i < partidosClasificados.length; i++) {
      const partido = partidosClasificados[i];
      
      if (partido.clasificacion === 'Ancla') {
        quiniela.push(partido.resultadoSugerido);
        continue;
      }
      
      // Construir lista de candidatos
      const candidatos = [
        { resultado: 'L', valor: partido.prob_local },
        { resultado: 'E', valor: partido.prob_empate },
        { resultado: 'V', valor: partido.prob_visitante }
      ];
      
      // Ordenar por valor
      candidatos.sort((a, b) => b.valor - a.valor);
      
      // Lista restringida de candidatos (RCL)
      const minValor = candidatos[candidatos.length - 1].valor;
      const maxValor = candidatos[0].valor;
      const umbral = maxValor - alpha * (maxValor - minValor);
      
      const rcl = candidatos.filter(c => c.valor >= umbral);
      
      // Selección aleatoria de la RCL
      const seleccionado = rcl[Math.floor(this.rng() * rcl.length)];
      quiniela.push(seleccionado.resultado);
    }
    
    return this.ajustarEmpates(quiniela, partidosClasificados);
  }

  generarVecinoInteligente(portafolio, partidosClasificados) {
    const nuevoPortafolio = portafolio.map(q => ({ 
      ...q, 
      resultados: [...q.resultados] 
    }));
    
    // Seleccionar quiniela a modificar (preferir las de menor score)
    const scoresIndividuales = nuevoPortafolio.map(q => q.prob_11_plus || 0);
    const probabilidadesSeleccion = scoresIndividuales.map(s => 1 / (s + 0.1));
    const suma = probabilidadesSeleccion.reduce((a, b) => a + b, 0);
    
    let rand = this.rng() * suma;
    let quinielaIdx = 0;
    for (let i = 0; i < probabilidadesSeleccion.length; i++) {
      rand -= probabilidadesSeleccion[i];
      if (rand <= 0) {
        quinielaIdx = i;
        break;
      }
    }
    
    const quiniela = nuevoPortafolio[quinielaIdx];
    
    // Seleccionar partidos para modificar (preferir los más volátiles)
    const partidosModificables = partidosClasificados
      .map((p, i) => ({ partido: p, index: i }))
      .filter(p => p.partido.clasificacion !== 'Ancla')
      .sort((a, b) => (b.partido.volatilidad || 0) - (a.partido.volatilidad || 0));
    
    if (partidosModificables.length > 0) {
      // Modificar 1-3 partidos
      const numModificaciones = Math.min(
        1 + Math.floor(this.rng() * 3),
        partidosModificables.length
      );
      
      for (let i = 0; i < numModificaciones; i++) {
        const { index } = partidosModificables[i];
        const partido = partidosClasificados[index];
        
        const alternativas = this.getAlternativasOrdenadas(partido);
        const actualIdx = alternativas.findIndex(alt => alt.resultado === quiniela.resultados[index]);
        
        // Seleccionar nueva alternativa (evitar la actual)
        let nuevaIdx;
        do {
          nuevaIdx = Math.floor(this.rng() * alternativas.length);
        } while (nuevaIdx === actualIdx && alternativas.length > 1);
        
        quiniela.resultados[index] = alternativas[nuevaIdx].resultado;
      }
      
      // Reajustar empates y recalcular métricas
      quiniela.resultados = this.ajustarEmpates(quiniela.resultados, partidosClasificados);
      quiniela.empates = quiniela.resultados.filter(r => r === 'E').length;
      quiniela.prob_11_plus = this.calcularProb11Plus(quiniela.resultados, partidosClasificados);
      quiniela.distribucion = this.calcularDistribucion(quiniela.resultados);
    }
    
    return nuevoPortafolio;
  }

  evaluarPortafolio(quinielas) {
    if (!quinielas || quinielas.length === 0) return 0;
    
    // Objetivo principal: maximizar Pr[≥11] del portafolio
    const probs11Plus = quinielas.map(q => Math.max(0.001, q.prob_11_plus || 0));
    const probPortafolio = 1 - probs11Plus.reduce((acc, prob) => acc * (1 - prob), 1);
    
    // Componentes del score
    const scorePortafolio = probPortafolio * 10; // Peso principal
    const scoreDiversidad = this.calcularDiversidadPortafolio(quinielas) * 2;
    const scoreDistribucion = this.evaluarDistribucion(quinielas) * 1.5;
    const scoreConcentracion = this.evaluarConcentracion(quinielas) * 1;
    const scoreEmpates = this.evaluarEmpates(quinielas) * 0.5;
    
    return scorePortafolio + scoreDiversidad + scoreDistribucion + scoreConcentracion + scoreEmpates;
  }

  calcularDiversidadPortafolio(quinielas) {
    if (quinielas.length < 2) return 1;
    
    let similitudPromedio = 0;
    let comparaciones = 0;
    
    for (let i = 0; i < quinielas.length; i++) {
      for (let j = i + 1; j < quinielas.length; j++) {
        const distancia = this.calcularDistanciaHamming(quinielas[i].resultados, quinielas[j].resultados);
        const similitud = 1 - (distancia / 14);
        similitudPromedio += similitud;
        comparaciones++;
      }
    }
    
    const similitudMedia = comparaciones > 0 ? similitudPromedio / comparaciones : 0;
    return Math.max(0, 1 - similitudMedia); // Queremos baja similitud (alta diversidad)
  }

  evaluarDistribucion(quinielas) {
    const totalPredicciones = quinielas.length * 14;
    const conteos = { L: 0, E: 0, V: 0 };
    
    quinielas.forEach(q => {
      q.resultados.forEach(r => conteos[r]++);
    });
    
    const distribucion = {
      L: conteos.L / totalPredicciones,
      E: conteos.E / totalPredicciones,
      V: conteos.V / totalPredicciones
    };
    
    let score = 0;
    Object.keys(PROGOL_CONFIG.RANGOS_HISTORICOS).forEach(resultado => {
      const [min, max] = PROGOL_CONFIG.RANGOS_HISTORICOS[resultado];
      const valor = distribucion[resultado];
      
      if (valor >= min && valor <= max) {
        score += 1;
      } else {
        const distanciaMin = Math.max(0, min - valor);
        const distanciaMax = Math.max(0, valor - max);
        const penalizacion = (distanciaMin + distanciaMax) * 5;
        score += Math.max(0, 1 - penalizacion);
      }
    });
    
    return score / 3;
  }

  evaluarConcentracion(quinielas) {
    let penalizacion = 0;
    const numQuinielas = quinielas.length;
    
    for (let partidoIdx = 0; partidoIdx < 14; partidoIdx++) {
      const conteos = { L: 0, E: 0, V: 0 };
      
      quinielas.forEach(q => {
        if (partidoIdx < q.resultados.length) {
          conteos[q.resultados[partidoIdx]]++;
        }
      });
      
      const maxConcentracion = Math.max(...Object.values(conteos)) / numQuinielas;
      const limite = partidoIdx < 3 ? 
        PROGOL_CONFIG.CONCENTRACION_MAX_INICIAL : 
        PROGOL_CONFIG.CONCENTRACION_MAX_GENERAL;
      
      if (maxConcentracion > limite) {
        penalizacion += Math.pow(maxConcentracion - limite, 2) * 3;
      }
    }
    
    return Math.max(0, 1 - penalizacion);
  }

  evaluarEmpates(quinielas) {
    const empatesPorQuiniela = quinielas.map(q => q.empates || 0);
    const empatesPromedio = empatesPorQuiniela.reduce((a, b) => a + b, 0) / empatesPorQuiniela.length;
    
    // Evaluar cercanía al promedio histórico
    const distanciaPromedio = Math.abs(empatesPromedio - PROGOL_CONFIG.EMPATES_PROMEDIO);
    
    // Evaluar que todas las quinielas estén en rango
    const quinielasEnRango = empatesPorQuiniela.filter(e => 
      e >= PROGOL_CONFIG.EMPATES_MIN && e <= PROGOL_CONFIG.EMPATES_MAX
    ).length;
    const proporcionEnRango = quinielasEnRango / quinielas.length;
    
    return (1 - distanciaPromedio / 2) * proporcionEnRango;
  }
}

// ==================== VALIDADOR MEJORADO ====================

class PortfolioValidator {
  validatePortfolio(quinielas) {
    const validacion = {
      es_valido: true,
      warnings: [],
      errores: [],
      metricas: {}
    };

    if (!quinielas || quinielas.length === 0) {
      validacion.es_valido = false;
      validacion.errores.push("No hay quinielas en el portafolio");
      return validacion;
    }

    this.validarDistribucionGlobal(quinielas, validacion);
    this.validarEmpatesIndividuales(quinielas, validacion);
    this.validarConcentracion(quinielas, validacion);
    this.validarDiversidad(quinielas, validacion);
    this.calcularMetricas(quinielas, validacion);

    // Criterios más flexibles para validación
    const erroresTolerables = validacion.errores.filter(e => 
      e.includes('ligeramente') || e.includes('moderadamente')
    ).length;
    
    if (validacion.errores.length - erroresTolerables > 0) {
      validacion.es_valido = false;
    } else if (validacion.warnings.length > 5) {
      // Solo invalidar si hay demasiadas advertencias críticas
      const warningsCriticas = validacion.warnings.filter(w => 
        w.includes('muy') || w.includes('excesiva') || w.includes('crítica')
      ).length;
      
      if (warningsCriticas > 2) {
        validacion.es_valido = false;
        validacion.errores.push("Demasiadas advertencias críticas en la validación");
      }
    }

    return validacion;
  }

  validarDistribucionGlobal(quinielas, validacion) {
    const totalPredicciones = quinielas.length * 14;
    const conteos = { L: 0, E: 0, V: 0 };

    quinielas.forEach(quiniela => {
      quiniela.resultados.forEach(resultado => conteos[resultado]++);
    });

    const distribucionGlobal = {
      L: conteos.L / totalPredicciones,
      E: conteos.E / totalPredicciones,
      V: conteos.V / totalPredicciones
    };

    validacion.metricas.distribucion_global = distribucionGlobal;

    Object.entries(distribucionGlobal).forEach(([resultado, proporcion]) => {
      const [minVal, maxVal] = PROGOL_CONFIG.RANGOS_HISTORICOS[resultado];
      const target = PROGOL_CONFIG.DISTRIBUCION_HISTORICA[resultado];

      if (proporcion < minVal) {
        const diferencia = minVal - proporcion;
        if (diferencia > 0.05) {
          validacion.errores.push(
            `Distribución ${resultado}: ${(proporcion * 100).toFixed(1)}% muy por debajo del mínimo ${(minVal * 100).toFixed(1)}%`
          );
        } else if (diferencia > 0.02) {
          validacion.warnings.push(
            `Distribución ${resultado}: ${(proporcion * 100).toFixed(1)}% moderadamente bajo (mín: ${(minVal * 100).toFixed(1)}%)`
          );
        }
      } else if (proporcion > maxVal) {
        const diferencia = proporcion - maxVal;
        if (diferencia > 0.05) {
          validacion.errores.push(
            `Distribución ${resultado}: ${(proporcion * 100).toFixed(1)}% muy por encima del máximo ${(maxVal * 100).toFixed(1)}%`
          );
        } else if (diferencia > 0.02) {
          validacion.warnings.push(
            `Distribución ${resultado}: ${(proporcion * 100).toFixed(1)}% moderadamente alto (máx: ${(maxVal * 100).toFixed(1)}%)`
          );
        }
      }
    });
  }

  validarEmpatesIndividuales(quinielas, validacion) {
    const empatesPorQuiniela = [];
    const quinielasProblematicas = [];

    quinielas.forEach((quiniela, i) => {
      const empates = quiniela.resultados.filter(r => r === 'E').length;
      empatesPorQuiniela.push(empates);

      if (empates < PROGOL_CONFIG.EMPATES_MIN) {
        quinielasProblematicas.push(`Q-${i + 1}: ${empates} empates (mínimo ${PROGOL_CONFIG.EMPATES_MIN})`);
      } else if (empates > PROGOL_CONFIG.EMPATES_MAX) {
        quinielasProblematicas.push(`Q-${i + 1}: ${empates} empates (máximo ${PROGOL_CONFIG.EMPATES_MAX})`);
      }
    });

    validacion.metricas.empates_promedio = empatesPorQuiniela.reduce((a, b) => a + b, 0) / empatesPorQuiniela.length;
    validacion.metricas.empates_rango = [Math.min(...empatesPorQuiniela), Math.max(...empatesPorQuiniela)];

    if (quinielasProblematicas.length > 0) {
      const proporcionProblematica = quinielasProblematicas.length / quinielas.length;
      if (proporcionProblematica > 0.2) {
        validacion.errores.push(`Muchas quinielas fuera del rango de empates: ${quinielasProblematicas.slice(0, 3).join(', ')}`);
      } else if (proporcionProblematica > 0.1) {
        validacion.warnings.push(`Algunas quinielas fuera del rango de empates: ${quinielasProblematicas.slice(0, 2).join(', ')}`);
      }
    }
  }

  validarConcentracion(quinielas, validacion) {
    const numQuinielas = quinielas.length;
    if (numQuinielas === 0) return;

    const concentracionesProblematicas = [];

    for (let partidoIdx = 0; partidoIdx < 14; partidoIdx++) {
      const conteos = { L: 0, E: 0, V: 0 };

      quinielas.forEach(quiniela => {
        if (partidoIdx < quiniela.resultados.length) {
          conteos[quiniela.resultados[partidoIdx]]++;
        }
      });

      const maxConcentracion = Math.max(...Object.values(conteos)) / numQuinielas;
      const limiteAplicable = partidoIdx < 3 ? 
        PROGOL_CONFIG.CONCENTRACION_MAX_INICIAL : 
        PROGOL_CONFIG.CONCENTRACION_MAX_GENERAL;

      if (maxConcentracion > limiteAplicable) {
        const excesoConcentracion = maxConcentracion - limiteAplicable;
        const resultadoConcentrado = Object.keys(conteos).reduce((a, b) => 
          conteos[a] > conteos[b] ? a : b
        );
        
        if (excesoConcentracion > 0.15) {
          concentracionesProblematicas.push(
            `Partido ${partidoIdx + 1}: ${(maxConcentracion * 100).toFixed(0)}% en '${resultadoConcentrado}' (límite: ${(limiteAplicable * 100).toFixed(0)}%)`
          );
        }
      }
    }

    if (concentracionesProblematicas.length > 0) {
      if (concentracionesProblematicas.length > 5) {
        validacion.errores.push(`Múltiples violaciones críticas de concentración: ${concentracionesProblematicas.slice(0, 3).join(', ')}`);
      } else if (concentracionesProblematicas.length > 2) {
        validacion.warnings.push(`Algunas violaciones de concentración: ${concentracionesProblematicas.slice(0, 2).join(', ')}`);
      }
    }
  }

  validarDiversidad(quinielas, validacion) {
    if (quinielas.length < 2) return;
    
    let similitudPromedio = 0;
    let comparaciones = 0;
    
    for (let i = 0; i < quinielas.length; i++) {
      for (let j = i + 1; j < quinielas.length; j++) {
        const distancia = this.calcularDistanciaHamming(quinielas[i].resultados, quinielas[j].resultados);
        const similitud = 1 - (distancia / 14);
        similitudPromedio += similitud;
        comparaciones++;
      }
    }
    
    const similitudMedia = comparaciones > 0 ? similitudPromedio / comparaciones : 0;
    validacion.metricas.similitud_promedio = similitudMedia;
    validacion.metricas.diversidad_score = 1 - similitudMedia;
    
    if (similitudMedia > 0.8) {
      validacion.warnings.push(`Diversidad baja: similitud promedio ${(similitudMedia * 100).toFixed(1)}%`);
    } else if (similitudMedia > 0.9) {
      validacion.errores.push(`Diversidad muy baja: similitud promedio ${(similitudMedia * 100).toFixed(1)}%`);
    }
  }

  calcularDistanciaHamming(q1, q2) {
    return q1.reduce((acc, val, i) => acc + (val !== q2[i] ? 1 : 0), 0);
  }

  calcularMetricas(quinielas, validacion) {
    if (quinielas.length === 0) return;

    const probs11Plus = quinielas.map(q => q.prob_11_plus || 0);
    
    validacion.metricas.prob_11_plus_promedio = probs11Plus.reduce((a, b) => a + b, 0) / probs11Plus.length;
    validacion.metricas.prob_11_plus_max = Math.max(...probs11Plus);
    validacion.metricas.prob_11_plus_min = Math.min(...probs11Plus);

    // Probabilidad del portafolio (al menos una quiniela con 11+)
    const probPortafolio = 1 - probs11Plus.reduce((acc, prob) => acc * (1 - prob), 1);
    validacion.metricas.prob_portafolio_11_plus = probPortafolio;

    const costoTotal = quinielas.length * 15;
    validacion.metricas.costo_total = costoTotal;
    validacion.metricas.eficiencia = probPortafolio / (costoTotal / 1000);
    
    // ROI esperado (estimado)
    const premioEstimado = 100000; // MXN estimado por premio
    const roi = (probPortafolio * premioEstimado - costoTotal) / costoTotal;
    validacion.metricas.roi_estimado = roi;
  }
}

// ==================== RESTO DEL CÓDIGO (DATOS, COMPONENTE PRINCIPAL, ETC.) ====================

const createSampleData = () => {
  const equiposRegular = [
    ['Real Madrid', 'Barcelona'],
    ['Manchester United', 'Liverpool'],
    ['PSG', 'Bayern Munich'],
    ['Chelsea', 'Arsenal'],
    ['Juventus', 'Inter Milan'],
    ['Atletico Madrid', 'Sevilla'],
    ['Borussia Dortmund', 'Bayern Leverkusen'],
    ['AC Milan', 'Napoli'],
    ['Ajax', 'PSV'],
    ['Porto', 'Benfica'],
    ['Lyon', 'Marseille'],
    ['Valencia', 'Athletic Bilbao'],
    ['Roma', 'Lazio'],
    ['Tottenham', 'West Ham']
  ];

  const equiposRevancha = [
    ['Flamengo', 'Palmeiras'],
    ['Boca Juniors', 'River Plate'],
    ['América', 'Chivas'],
    ['São Paulo', 'Corinthians'],
    ['Cruz Azul', 'Pumas'],
    ['Santos', 'Fluminense'],
    ['Monterrey', 'Tigres']
  ];

  const generatePartidos = (equipos, withFinals = false) => {
    return equipos.map(([local, visitante], i) => {
      // Generar probabilidades más realistas y variadas
      const seed = i * 123456789;
      const rand1 = Math.sin(seed) * 10000 % 1;
      const rand2 = Math.sin(seed * 2) * 10000 % 1;
      const rand3 = Math.sin(seed * 3) * 10000 % 1;
      
      let probLocal, probEmpate, probVisitante;
      
      if (rand1 < 0.3) {
        // Favorito claro local
        probLocal = 0.45 + rand2 * 0.25;
        probEmpate = 0.20 + rand3 * 0.15;
        probVisitante = 1 - probLocal - probEmpate;
      } else if (rand1 < 0.6) {
        // Partido equilibrado
        probLocal = 0.25 + rand2 * 0.20;
        probEmpate = 0.25 + rand3 * 0.20;
        probVisitante = 1 - probLocal - probEmpate;
      } else {
        // Favorito visitante
        probVisitante = 0.40 + rand2 * 0.25;
        probEmpate = 0.20 + rand3 * 0.15;
        probLocal = 1 - probVisitante - probEmpate;
      }

      return {
        local,
        visitante,
        prob_local: Math.max(0.10, probLocal),
        prob_empate: Math.max(0.15, probEmpate),
        prob_visitante: Math.max(0.10, probVisitante),
        es_final: withFinals && (i === 0 || i === 6 || i === 12),
        forma_diferencia: Math.floor((rand1 - 0.5) * 6),
        lesiones_impact: Math.floor((rand2 - 0.5) * 4)
      };
    });
  };

  return {
    partidos_regular: generatePartidos(equiposRegular, true),
    partidos_revancha: generatePartidos(equiposRevancha, true)
  };
};

// ==================== COMPONENTE PRINCIPAL ====================

export default function ProgolOptimizerApp() {
  const [partidosRegular, setPartidosRegular] = useState([]);
  const [partidosRevancha, setPartidosRevancha] = useState([]);
  const [partidosClasificados, setPartidosClasificados] = useState([]);
  const [quinielasCore, setQuinielasCore] = useState([]);
  const [quinielasSatelites, setQuinielasSatelites] = useState([]);
  const [quinielasFinales, setQuinielasFinales] = useState([]);
  const [validacion, setValidacion] = useState(null);
  
  const [activeTab, setActiveTab] = useState('datos');
  const [loading, setLoading] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [optimizationProgress, setOptimizationProgress] = useState(null);
  const [config, setConfig] = useState({
    numQuinielas: 20,
    empatesMin: 4,
    empatesMax: 6,
    concentracionGeneral: 0.70,
    concentracionInicial: 0.60,
    correlacionTarget: -0.35,
    iteracionesOptimizador: 2000, // Reducido para evitar congelamiento
    temperaturaInicial: 0.50,     // Más conservador
    tasaEnfriamiento: 0.998,      // Enfriamiento más lento
    simulacionesMonteCarlo: 3000  // Reducido para mejor performance
  });

  const [progress, setProgress] = useState({
    datos: false,
    clasificacion: false,
    core: false,
    satelites: false,
    validacion: false
  });

  React.useEffect(() => {
    setProgress(prev => ({
      ...prev,
      datos: partidosRegular.length >= 14,
      clasificacion: partidosClasificados.length > 0,
      core: quinielasCore.length > 0,
      satelites: quinielasSatelites.length > 0,
      validacion: quinielasFinales.length > 0
    }));
  }, [partidosRegular, partidosClasificados, quinielasCore, quinielasSatelites, quinielasFinales]);

  const cargarDatosMuestra = useCallback(() => {
    const sampleData = createSampleData();
    setPartidosRegular(sampleData.partidos_regular);
    setPartidosRevancha(sampleData.partidos_revancha);
  }, []);

  const clasificarPartidos = useCallback(async () => {
    if (partidosRegular.length < 14) {
      alert('Necesitas al menos 14 partidos regulares');
      return;
    }

    setLoading(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 500));
      const classifier = new MatchClassifier();
      const clasificados = classifier.classifyMatches(partidosRegular);
      setPartidosClasificados(clasificados);
    } catch (error) {
      console.error('Error clasificando partidos:', error);
      alert('Error al clasificar partidos');
    } finally {
      setLoading(false);
    }
  }, [partidosRegular]);

  const generarQuinielasCore = useCallback(async () => {
    if (partidosClasificados.length === 0) {
      alert('Primero clasifica los partidos');
      return;
    }

    setLoading(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 800));
      const generator = new PortfolioGenerator(42, config);
      const core = generator.generateCoreQuinielas(partidosClasificados);
      setQuinielasCore(core);
    } catch (error) {
      console.error('Error generando Core:', error);
      alert('Error al generar quinielas Core');
    } finally {
      setLoading(false);
    }
  }, [partidosClasificados, config]);

  const generarQuinielasSatelites = useCallback(async () => {
    if (quinielasCore.length === 0) {
      alert('Primero genera las quinielas Core');
      return;
    }

    setLoading(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 1200));
      const generator = new PortfolioGenerator(42, config);
      const numSatelites = config.numQuinielas - 4;
      const satelites = generator.generateSatelliteQuinielas(
        partidosClasificados,
        quinielasCore,
        numSatelites
      );
      setQuinielasSatelites(satelites);
    } catch (error) {
      console.error('Error generando Satélites:', error);
      alert('Error al generar quinielas Satélites');
    } finally {
      setLoading(false);
    }
  }, [quinielasCore, partidosClasificados, config]);

  const ejecutarOptimizacionAvanzada = useCallback(async () => {
    if (quinielasCore.length === 0 || quinielasSatelites.length === 0) {
      alert('Necesitas generar Core y Satélites primero');
      return;
    }

    setLoading(true);
    setOptimizationProgress({ iteracion: 0, score: 0, porcentaje: 0 });
    
    try {
      const generator = new PortfolioGenerator(42, config);
      const validator = new PortfolioValidator();
      
      const candidatas = [...quinielasCore, ...quinielasSatelites];
      
      const quinielasOptimizadas = await generator.optimizePortfolioGRASPAnnealing(
        candidatas,
        partidosClasificados,
        (progress) => {
          setOptimizationProgress(progress);
        }
      );
      
      const resultadoValidacion = validator.validatePortfolio(quinielasOptimizadas);
      
      setQuinielasFinales(quinielasOptimizadas);
      setValidacion(resultadoValidacion);
      
      setOptimizationProgress(null);
      
      if (resultadoValidacion.es_valido) {
        alert(`✅ Optimización completada exitosamente!\n🎯 Pr[≥11] Portafolio: ${(resultadoValidacion.metricas.prob_portafolio_11_plus * 100).toFixed(1)}%\n💰 ROI Estimado: ${(resultadoValidacion.metricas.roi_estimado * 100).toFixed(1)}%`);
      } else {
        alert(`⚠️ Optimización completada con algunas advertencias\n🎯 Pr[≥11] Portafolio: ${(resultadoValidacion.metricas.prob_portafolio_11_plus * 100).toFixed(1)}%\nRevisar en la sección Resultados`);
      }
    } catch (error) {
      console.error('Error en optimización:', error);
      alert('Error en optimización avanzada');
    } finally {
      setLoading(false);
      setOptimizationProgress(null);
    }
  }, [quinielasCore, quinielasSatelites, partidosClasificados, config]);

  const procesarArchivoCSV = useCallback((file, tipo) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const csv = e.target.result;
        const lines = csv.split('\n').filter(line => line.trim() && !line.startsWith('#'));
        const headers = lines[0].split(',').map(h => h.trim());
        
        const partidos = [];
        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(',').map(v => v.trim());
          if (values.length >= 5) {
            const probTotal = parseFloat(values[2]) + parseFloat(values[3]) + parseFloat(values[4]);
            
            partidos.push({
              local: values[0],
              visitante: values[1],
              prob_local: parseFloat(values[2]) / probTotal,
              prob_empate: parseFloat(values[3]) / probTotal,
              prob_visitante: parseFloat(values[4]) / probTotal,
              es_final: values[5] === 'TRUE' || values[5] === 'true',
              forma_diferencia: parseInt(values[6]) || 0,
              lesiones_impact: parseInt(values[7]) || 0
            });
          }
        }
        
        if (tipo === 'regular') {
          setPartidosRegular(partidos.slice(0, 14));
        } else {
          setPartidosRevancha(partidos.slice(0, 7));
        }
      } catch (error) {
        alert('Error procesando el archivo CSV');
      }
    };
    reader.readAsText(file);
  }, []);

  // ... [El resto del componente de renderizado permanece igual] ...

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                <Target className="w-8 h-8 text-blue-600" />
                Progol Optimizer
              </h1>
              <p className="text-gray-600">Metodología Definitiva Core + Satélites</p>
            </div>
            
            <div className="flex items-center gap-4 text-sm">
              <span className="text-gray-500">v1.0.0</span>
              <div className={`px-2 py-1 rounded text-xs ${
                Object.values(progress).filter(Boolean).length >= 3 ? 
                'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-600'
              }`}>
                {Object.values(progress).filter(Boolean).length}/5 pasos
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="bg-white rounded-lg shadow-sm border mb-6 p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Target className="w-5 h-5" />
              Progreso de la Metodología
            </h3>
            <span className="text-sm text-gray-500">
              {Object.values(progress).filter(Boolean).length}/5 completados
            </span>
          </div>
          
          <div className="grid grid-cols-5 gap-2">
            {[
              { key: 'datos', label: 'Datos', icon: Database },
              { key: 'clasificacion', label: 'Clasificación', icon: Brain },
              { key: 'core', label: 'Core', icon: Target },
              { key: 'satelites', label: 'Satélites', icon: RefreshCw },
              { key: 'validacion', label: 'Validación', icon: CheckCircle2 }
            ].map(({ key, label, icon: Icon }) => (
              <div key={key} className="text-center">
                <div className={`mx-auto w-8 h-8 rounded-full flex items-center justify-center mb-1 ${
                  progress[key] ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400'
                }`}>
                  <Icon className="w-4 h-4" />
                </div>
                <span className={`text-xs ${progress[key] ? 'text-green-600' : 'text-gray-400'}`}>
                  {label}
                </span>
              </div>
            ))}
          </div>
        </div>
        
        <div className="flex space-x-1 mb-6 bg-gray-100 p-1 rounded-lg">
          {[
            { id: 'datos', label: 'Entrada de Datos', icon: Database },
            { id: 'generacion', label: 'Generación', icon: Zap },
            { id: 'resultados', label: 'Resultados', icon: BarChart3 },
            { id: 'exportacion', label: 'Exportar', icon: FileDown }
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-md font-medium transition-colors ${
                activeTab === id
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>

        {/* Aquí continúa con las mismas secciones de renderizado del código original... */}
        {/* Solo mostraré las primeras secciones para mantener la respuesta manejable */}
        
        {activeTab === 'datos' && (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-sm border">
              <div className="p-6">
                <h2 className="text-xl font-semibold mb-2 flex items-center gap-2">
                  <Database className="w-5 h-5" />
                  Configuración de Datos
                </h2>
                <p className="text-gray-600 mb-6">
                  Carga partidos o usa datos de muestra para comenzar
                </p>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-blue-600">{partidosRegular.length}/14</div>
                    <div className="text-sm text-gray-600">Partidos Regulares</div>
                    <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
                      <div 
                        className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${Math.min(partidosRegular.length / 14 * 100, 100)}%` }}
                      />
                    </div>
                  </div>
                  
                  <div className="text-center">
                    <div className="text-2xl font-bold text-green-600">{partidosRevancha.length}/7</div>
                    <div className="text-sm text-gray-600">Partidos Revancha</div>
                    <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
                      <div 
                        className="bg-green-600 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${Math.min(partidosRevancha.length / 7 * 100, 100)}%` }}
                      />
                    </div>
                  </div>
                  
                  <div className="text-center">
                    <div className="text-2xl font-bold text-purple-600">{(partidosRegular.length + partidosRevancha.length)}/21</div>
                    <div className="text-sm text-gray-600">Total Progreso</div>
                    <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
                      <div 
                        className="bg-purple-600 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${Math.min((partidosRegular.length + partidosRevancha.length) / 21 * 100, 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
                
                <div className="flex flex-wrap gap-4">
                  <button
                    onClick={cargarDatosMuestra}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    <Bot className="w-4 h-4" />
                    Cargar Datos de Muestra
                  </button>
                  
                  <label className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors cursor-pointer">
                    <Upload className="w-4 h-4" />
                    Cargar CSV Regular
                    <input
                      type="file"
                      accept=".csv"
                      className="hidden"
                      onChange={(e) => e.target.files[0] && procesarArchivoCSV(e.target.files[0], 'regular')}
                    />
                  </label>
                  
                  <label className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors cursor-pointer">
                    <Upload className="w-4 h-4" />
                    Cargar CSV Revancha
                    <input
                      type="file"
                      accept=".csv"
                      className="hidden"
                      onChange={(e) => e.target.files[0] && procesarArchivoCSV(e.target.files[0], 'revancha')}
                    />
                  </label>
                </div>
              </div>
            </div>
            
            {/* Resto de la sección de datos... */}
          </div>
        )}
        
        {/* Las demás secciones de activeTab permanecen iguales */}
      </div>
    </div>
  );
}

// ==================== FUNCIONES AUXILIARES ====================

function generateCSVExport(quinielas) {
  const headers = ['Quiniela', 'Tipo', ...Array.from({length: 14}, (_, i) => `P${i+1}`), 'Empates', 'Prob_11_Plus'];
  const rows = quinielas.map((q, i) => [
    `Q-${i+1}`,
    q.tipo,
    ...q.resultados,
    q.empates,
    ((q.prob_11_plus || 0) * 100).toFixed(2)
  ]);
  
  return [headers, ...rows].map(row => row.join(',')).join('\n');
}

function generateJSONExport(quinielas, partidos, validacion) {
  const exportData = {
    metadata: {
      fecha_generacion: new Date().toISOString(),
      total_quinielas: quinielas.length,
      metodologia: 'Core + Satélites GRASP-Annealing',
      distribucion_historica: PROGOL_CONFIG.DISTRIBUCION_HISTORICA
    },
    partidos: partidos,
    quinielas: quinielas,
    validacion: validacion
  };
  
  return JSON.stringify(exportData, null, 2);
}

function generateProgolFormat(quinielas, partidos) {
  const lines = [
    'PROGOL OPTIMIZER - QUINIELAS OPTIMIZADAS',
    '=' .repeat(50),
    `Generado: ${new Date().toLocaleString()}`,
    `Total quinielas: ${quinielas.length}`,
    '',
    'PARTIDOS:',
    ...partidos.slice(0, 14).map((p, i) => `${String(i+1).padStart(2)}. ${p.local} vs ${p.visitante}`),
    '',
    'QUINIELAS:',
    ...quinielas.map((q, i) => {
      const resultados = q.resultados.join(' ');
      const prob = ((q.prob_11_plus || 0) * 100).toFixed(1);
      return `Q-${String(i+1).padStart(2)}: ${resultados} | Empates: ${q.empates} | Pr[≥11]: ${prob}%`;
    })
  ];
  
  return lines.join('\n');
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}