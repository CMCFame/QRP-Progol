import React, { useState, useCallback } from 'react';
import { Target, Database, Brain, RefreshCw, CheckCircle2, BarChart3, FileDown, Bot, Upload, Settings, Zap, Gauge } from 'lucide-react';
import './App.css';

// ==================== CONFIGURACIÓN Y CONSTANTES ====================

const PROGOL_CONFIG = {
  // Source: Metodología Definitiva Progol.docx 
  DISTRIBUCION_HISTORICA: { L: 0.38, E: 0.29, V: 0.33 },
  // Source: Metodología Definitiva Progol.docx 
  RANGOS_HISTORICOS: {
    L: [0.35, 0.41],
    // Source: Metodología Definitiva Progol.docx 
    E: [0.25, 0.33],
    // Source: Metodología Definitiva Progol.docx 
    V: [0.30, 0.36]
  },
  // Source: Metodología Definitiva Progol.docx 
  EMPATES_PROMEDIO: 4.33,
  // Source: Metodología Definitiva Progol.docx 
  EMPATES_MIN: 4,
  EMPATES_MAX: 6,
  // Source: Metodología Definitiva Progol.docx 
  CONCENTRACION_MAX_GENERAL: 0.70,
  CONCENTRACION_MAX_INICIAL: 0.60,
  // Source: Metodología Definitiva Progol.docx 
  CALIBRACION: {
    k1_forma: 0.15,
    k2_lesiones: 0.10,
    k3_contexto: 0.20
  },
  // Source: Metodología Definitiva Progol.docx 
  DRAW_PROPENSITY: {
    umbral_diferencia: 0.08,
    boost_empate: 0.06
  }
};

// ==================== SUGERENCIA DE MEJORA ====================
// Para facilitar el mantenimiento futuro, se recomienda dividir las siguientes
// clases (MatchClassifier, PortfolioGenerator, PortfolioValidator) en archivos
// separados dentro de una nueva carpeta 'src/logic/'. Esto hará que el código
// sea más fácil de leer y gestionar a medida que la aplicación crezca.

// ==================== CLASES PRINCIPALES ====================

class MatchClassifier {
  constructor() {
    // Source: Metodología Definitiva Progol.docx 
    this.umbralAncla = 0.60;
    this.umbralDivisorMin = 0.40;
    this.umbralDivisorMax = 0.60;
    // Source: Metodología Definitiva Progol.docx 
    this.umbralEmpate = 0.30;
  }

  classifyMatches(partidos) {
    return partidos.map((partido, i) => {
      // Source: Metodología Definitiva Progol.docx 
      const partidoCalibrado = this.aplicarCalibracionBayesiana(partido);
      // Source: Metodología Definitiva Progol.docx 
      const clasificacion = this.clasificarPartido(partidoCalibrado);
      
      return {
        id: i,
        local: partido.local,
        visitante: partido.visitante,
        ...partidoCalibrado,
        clasificacion,
        resultadoSugerido: this.getResultadoSugerido(partidoCalibrado),
        confianza: this.calcularConfianza(partidoCalibrado)
      };
    });
  }

  // Source: Metodología Definitiva Progol.docx 
  aplicarCalibracionBayesiana(partido) {
    const { k1_forma, k2_lesiones, k3_contexto } = PROGOL_CONFIG.CALIBRACION;
    
    const deltaForma = partido.forma_diferencia || 0;
    const lesionesImpact = partido.lesiones_impact || 0;
    const contexto = partido.es_final ? 1.0 : 0.0;
    
    // Source: Metodología Definitiva Progol.docx 
    const factorAjuste = 1 + k1_forma * deltaForma + k2_lesiones * lesionesImpact + k3_contexto * contexto;
    
    let probLocal = partido.prob_local * factorAjuste;
    let probEmpate = partido.prob_empate;
    let probVisitante = partido.prob_visitante / Math.max(factorAjuste, 0.1);
    
    // Source: Metodología Definitiva Progol.docx 
    // Aplicar Draw-Propensity Rule
    if (Math.abs(probLocal - probVisitante) < PROGOL_CONFIG.DRAW_PROPENSITY.umbral_diferencia &&
        probEmpate > Math.max(probLocal, probVisitante)) {
      probEmpate = Math.min(probEmpate + PROGOL_CONFIG.DRAW_PROPENSITY.boost_empate, 0.95);
    }
    
    // Renormalizar
    const total = probLocal + probEmpate + probVisitante;
    
    return {
      prob_local: probLocal / total,
      prob_empate: probEmpate / total,
      prob_visitante: probVisitante / total
    };
  }

  // Source: Metodología Definitiva Progol.docx 
  clasificarPartido(partido) {
    const probs = [partido.prob_local, partido.prob_empate, partido.prob_visitante];
    const maxProb = Math.max(...probs);
    
    if (maxProb > this.umbralAncla) return 'Ancla';
    if (partido.prob_empate > this.umbralEmpate && 
        partido.prob_empate >= Math.max(partido.prob_local, partido.prob_visitante)) {
      return 'TendenciaEmpate';
    }
    if (maxProb >= this.umbralDivisorMin && maxProb < this.umbralDivisorMax) return 'Divisor';
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
}

class PortfolioGenerator {
  constructor(seed = 42, config = {}) {
    this.seed = seed;
    this.config = {
      iteracionesOptimizador: 5000,
      temperaturaInicial: 0.80,
      tasaEnfriamiento: 0.995,
      // Source: Metodología Definitiva Progol.docx 
      simulacionesMonteCarlo: 5000,
      ...config
    };
  }

  // Source: Metodología Definitiva Progol.docx 
  generateCoreQuinielas(partidosClasificados) {
    const coreQuinielas = [];
    
    for (let i = 0; i < 4; i++) {
      let quiniela = this.crearQuinielaBase(partidosClasificados);
      
      if (i > 0) {
        quiniela = this.aplicarVariacion(quiniela, partidosClasificados, i);
      }
      
      quiniela = this.ajustarEmpates(quiniela, partidosClasificados);
      
      const quinielaObj = {
        id: `Core-${i + 1}`,
        tipo: 'Core',
        resultados: quiniela,
        empates: quiniela.filter(r => r === 'E').length,
        prob_11_plus: this.calcularProb11Plus(quiniela, partidosClasificados),
        distribucion: this.calcularDistribucion(quiniela)
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
      
      // Source: Metodología Definitiva Progol.docx 
      if (partido.clasificacion === 'Ancla') {
        resultado = partido.resultadoSugerido;
      } else if (partido.clasificacion === 'TendenciaEmpate' && empatesActuales < PROGOL_CONFIG.EMPATES_MAX) {
        resultado = 'E';
      } else {
        resultado = partido.resultadoSugerido;
      }
      
      if (resultado === 'E') empatesActuales++;
      quiniela.push(resultado);
    }
    
    return quiniela;
  }

  // Source: Metodología Definitiva Progol.docx 
  generateSatelliteQuinielas(partidosClasificados, quinielasCore, numSatelites) {
    const satelites = [];
    const numPares = Math.floor(numSatelites / 2);
    
    const partidosDivisor = partidosClasificados
      .map((p, i) => ({ ...p, index: i }))
      // Source: Metodología Definitiva Progol.docx 
      .filter(p => p.clasificacion === 'Divisor');
    
    for (let par = 0; par < numPares; par++) {
      // Source: Metodología Definitiva Progol.docx 
      const [satA, satB] = this.crearParSatelites(
        partidosClasificados,
        partidosDivisor,
        par
      );
      satelites.push(satA, satB);
    }
    
    if (numSatelites % 2 === 1) {
      const satExtra = this.crearSateliteIndividual(partidosClasificados, satelites.length);
      satelites.push(satExtra);
    }
    
    return satelites;
  }

  crearParSatelites(partidosClasificados, partidosDivisor, parId) {
    const partidoPrincipal = partidosDivisor[parId % partidosDivisor.length]?.index || 0;
    
    const quinielaA = [];
    const quinielaB = [];
    
    for (let i = 0; i < partidosClasificados.length; i++) {
      const partido = partidosClasificados[i];
      
      // Source: Metodología Definitiva Progol.docx 
      if (i === partidoPrincipal) {
        quinielaA.push(partido.resultadoSugerido);
        quinielaB.push(this.getResultadoAlternativo(partido));
      } else if (partido.clasificacion === 'Ancla') {
        const resultado = partido.resultadoSugerido;
        quinielaA.push(resultado);
        quinielaB.push(resultado);
      } else {
        // Introduce controlled randomness for diversity
        if (Math.random() < 0.3) {
          quinielaA.push(partido.resultadoSugerido);
          quinielaB.push(this.getResultadoAlternativo(partido));
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
      par_id: parId
    };
    
    const satB = {
      id: `Sat-${parId * 2 + 1}B`,
      tipo: 'Satelite', 
      resultados: this.ajustarEmpates(quinielaB, partidosClasificados),
      par_id: parId
    };
    
    [satA, satB].forEach(sat => {
      sat.empates = sat.resultados.filter(r => r === 'E').length;
      sat.prob_11_plus = this.calcularProb11Plus(sat.resultados, partidosClasificados);
      sat.distribucion = this.calcularDistribucion(sat.resultados);
    });
    
    return [satA, satB];
  }

  crearSateliteIndividual(partidosClasificados, sateliteId) {
    let quiniela = this.crearQuinielaBase(partidosClasificados);
    
    for (let i = 0; i < partidosClasificados.length; i++) {
      const partido = partidosClasificados[i];
      if (partido.clasificacion !== 'Ancla' && Math.random() < 0.4) {
        quiniela[i] = this.getResultadoAlternativo(partido);
      }
    }
    
    quiniela = this.ajustarEmpates(quiniela, partidosClasificados);
    
    return {
      id: `Sat-${sateliteId + 1}`,
      tipo: 'Satelite',
      resultados: quiniela,
      empates: quiniela.filter(r => r === 'E').length,
      prob_11_plus: this.calcularProb11Plus(quiniela, partidosClasificados),
      distribucion: this.calcularDistribucion(quiniela),
      par_id: null
    };
  }

  getResultadoAlternativo(partido) {
    const probs = [
      { resultado: 'L', prob: partido.prob_local },
      { resultado: 'E', prob: partido.prob_empate },
      { resultado: 'V', prob: partido.prob_visitante }
    ];
    
    probs.sort((a, b) => b.prob - a.prob);
    // Return the second most likely result for diversification
    return probs[1].resultado;
  }

  ajustarEmpates(quiniela, partidosClasificados) {
    const empatesActuales = quiniela.filter(r => r === 'E').length;
    const quinielaAjustada = [...quiniela];
    
    // Source: Metodología Definitiva Progol.docx 
    if (empatesActuales < PROGOL_CONFIG.EMPATES_MIN) {
      const empatesNecesarios = PROGOL_CONFIG.EMPATES_MIN - empatesActuales;
      const candidatos = [];
      
      for (let i = 0; i < quinielaAjustada.length; i++) {
        if (quinielaAjustada[i] !== 'E' && partidosClasificados[i].prob_empate > 0.20) {
          candidatos.push({ index: i, prob: partidosClasificados[i].prob_empate });
        }
      }
      
      candidatos.sort((a, b) => b.prob - a.prob);
      
      for (let i = 0; i < Math.min(empatesNecesarios, candidatos.length); i++) {
        quinielaAjustada[candidatos[i].index] = 'E';
      }
    } else if (empatesActuales > PROGOL_CONFIG.EMPATES_MAX) {
      const empatesExceso = empatesActuales - PROGOL_CONFIG.EMPATES_MAX;
      const candidatosEmpate = [];
      
      for (let i = 0; i < quinielaAjustada.length; i++) {
        if (quinielaAjustada[i] === 'E') {
          candidatosEmpate.push({ index: i, prob: partidosClasificados[i].prob_empate });
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

  aplicarVariacion(quiniela, partidosClasificados, variacion) {
    const quinielaVariada = [...quiniela];
    const candidatos = [];
    
    for (let i = 0; i < partidosClasificados.length; i++) {
      if (partidosClasificados[i].clasificacion !== 'Ancla') {
        candidatos.push(i);
      }
    }
    
    // Shuffle and pick a few to change for variety
    const numCambios = Math.min(1 + variacion, candidatos.length);
    const indicesCambio = this.shuffleArray(candidatos).slice(0, numCambios);
    
    for (const idx of indicesCambio) {
      quinielaVariada[idx] = this.getResultadoAlternativo(partidosClasificados[idx]);
    }
    
    return quinielaVariada;
  }

  shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  // Source: Metodología Definitiva Progol.docx 
  calcularProb11Plus(quiniela, partidosClasificados) {
    const probsAcierto = [];
    
    for (let i = 0; i < quiniela.length; i++) {
      const resultado = quiniela[i];
      const partido = partidosClasificados[i];
      
      let prob;
      if (resultado === 'L') prob = partido.prob_local;
      else if (resultado === 'E') prob = partido.prob_empate;
      else prob = partido.prob_visitante;
      
      probsAcierto.push(prob);
    }
    
    const numSimulaciones = this.config.simulacionesMonteCarlo;
    let aciertos11Plus = 0;
    
    // Monte Carlo Simulation
    for (let sim = 0; sim < numSimulaciones; sim++) {
      let aciertos = 0;
      for (const prob of probsAcierto) {
        if (Math.random() < prob) aciertos++;
      }
      if (aciertos >= 11) aciertos11Plus++;
    }
    
    return aciertos11Plus / numSimulaciones;
  }

  calcularDistribucion(quiniela) {
    const total = quiniela.length;
    return {
      L: quiniela.filter(r => r === 'L').length / total,
      E: quiniela.filter(r => r === 'E').length / total,
      V: quiniela.filter(r => r === 'V').length / total
    };
  }

  // ==================== CORRECCIÓN DE CÓDIGO ====================
  // La función de optimización ha sido reescrita para implementar correctamente
  // el algoritmo GRASP-Annealing de dos fases descrito en la metodología.

  // Source: Metodología Definitiva Progol.docx 
  optimizePortfolioGRASPAnnealing(quinielasIniciales, partidosClasificados, progressCallback) {
    const validator = new PortfolioValidator();
    const config = this.config;

    // --- FASE 1: GRASP (Greedy Randomized Adaptive Search Procedure) ---
    progressCallback({ phase: 'GRASP', message: 'Building candidate pool...', percentage: 0 });

    const NUM_CANDIDATES = 1000; // Practical number of candidates
    let candidatePool = [];

    for (let i = 0; i < NUM_CANDIDATES; i++) {
        let quiniela = this.crearQuinielaBase(partidosClasificados);
        quiniela = this.aplicarVariacion(quiniela, partidosClasificados, Math.floor(Math.random() * 5));
        quiniela = this.ajustarEmpates(quiniela, partidosClasificados);
        
        const quinielaObj = {
            id: `Cand-${i}`,
            tipo: 'Satelite',
            resultados: quiniela,
            empates: quiniela.filter(r => r === 'E').length,
            prob_11_plus: this.calcularProb11Plus(quiniela, partidosClasificados),
            distribucion: this.calcularDistribucion(quiniela)
        };
        candidatePool.push(quinielaObj);
        
        if (i % 50 === 0) {
            progressCallback({ phase: 'GRASP', message: 'Building candidate pool...', percentage: (i / NUM_CANDIDATES) * 50 });
        }
    }

    progressCallback({ phase: 'GRASP', message: 'Constructing portfolio...', percentage: 50 });
    
    let constructedPortfolio = [...quinielasIniciales];
    const ALPHA = 0.15; // Select randomly from top 15% of candidates

    // Source: Metodología Definitiva Progol.docx 
    while (constructedPortfolio.length < config.numQuinielas && candidatePool.length > 0) {
        candidatePool.forEach(cand => {
            const tempPortfolio = [...constructedPortfolio, cand];
            cand.marginalGain = this.evaluarPortafolio(tempPortfolio) - this.evaluarPortafolio(constructedPortfolio);
        });

        candidatePool.sort((a, b) => b.marginalGain - a.marginalGain);

        const topN = Math.max(1, Math.floor(candidatePool.length * ALPHA));
        const selectedIndex = Math.floor(Math.random() * topN);
        const bestCandidate = candidatePool.splice(selectedIndex, 1)[0];
        
        constructedPortfolio.push(bestCandidate);
    }
    
    // --- FASE 2: Simulated Annealing Refinement ---
    let mejorPortafolio = constructedPortfolio;
    let mejorScore = this.evaluarPortafolio(mejorPortafolio);
    let temperatura = config.temperaturaInicial;

    // Source: Metodología Definitiva Progol.docx 
    for (let iter = 0; iter < config.iteracionesOptimizador; iter++) {
        const vecinoPortafolio = this.generarVecino(mejorPortafolio, partidosClasificados);
        
        // **FIX**: Validate the entire portfolio against the checklist.
        // If it's not valid, reject it immediately.
        const validationResult = validator.validatePortfolio(vecinoPortafolio);
        if (!validationResult.es_valido) {
            temperatura *= config.tasaEnfriamiento;
            continue;
        }

        const scoreVecino = this.evaluarPortafolio(vecinoPortafolio);
        const delta = scoreVecino - mejorScore;
        
        // Annealing acceptance criteria
        if (delta > 0 || Math.random() < Math.exp(delta / temperatura)) {
            mejorPortafolio = vecinoPortafolio;
            mejorScore = scoreVecino;
        }
        
        temperatura *= config.tasaEnfriamiento;
        
        if (progressCallback && iter % 50 === 0) {
            progressCallback({
                phase: 'Annealing',
                message: 'Refining portfolio...',
                iteracion: iter,
                score: mejorScore,
                porcentaje: (iter / config.iteracionesOptimizador) * 100
            });
        }
    }
    
    return mejorPortafolio;
  }


  // ==================== CORRECCIÓN DE CÓDIGO ====================
  // La función de evaluación ha sido corregida para alinearse con el objetivo
  // principal de la metodología: maximizar Pr[>=11]. Los otros factores
  // ahora se usan como restricciones duras en el validador.

  // Source: Metodología Definitiva Progol.docx 
  evaluarPortafolio(quinielas) {
    if (!quinielas || quinielas.length === 0) return 0;
    
    const probs11Plus = quinielas.map(q => q.prob_11_plus || 0);
    // The objective function is to maximize the probability of the portfolio getting at least one 11+ hit
    const probPortafolio = 1 - probs11Plus.reduce((acc, prob) => acc * (1 - prob), 1);
    
    return probPortafolio;
  }

  calcularDiversidadPortafolio(quinielas) {
    if (quinielas.length < 2) return 1;
    
    let similitudPromedio = 0;
    let comparaciones = 0;
    
    for (let i = 0; i < quinielas.length; i++) {
      for (let j = i + 1; j < quinielas.length; j++) {
        const distancia = this.calcularDistanciaHamming(quinielas[i].resultados, quinielas[j].resultados);
        similitudPromedio += 1 - (distancia / 14);
        comparaciones++;
      }
    }
    
    return comparaciones > 0 ? 1 - (similitudPromedio / comparaciones) : 1;
  }

  calcularDistanciaHamming(q1, q2) {
    return q1.reduce((acc, val, i) => acc + (val !== q2[i] ? 1 : 0), 0);
  }

  generarVecino(portafolio, partidosClasificados) {
    const nuevoPortafolio = portafolio.map(q => ({ ...q, resultados: [...q.resultados] }));
    
    if (nuevoPortafolio.length === 0) return [];

    const quinielaIdx = Math.floor(Math.random() * nuevoPortafolio.length);
    const quiniela = nuevoPortafolio[quinielaIdx];
    
    const partidosNoAncla = partidosClasificados
      .map((p, i) => ({ partido: p, index: i }))
      .filter(p => p.partido.clasificacion !== 'Ancla');
    
    if (partidosNoAncla.length > 0) {
      const { index } = partidosNoAncla[Math.floor(Math.random() * partidosNoAncla.length)];
      const partido = partidosClasificados[index];
      
      const opciones = ['L', 'E', 'V'];
      const resultadoActual = quiniela.resultados[index];
      const alternativo = opciones.filter(o => o !== resultadoActual)[Math.floor(Math.random() * 2)];
      
      quiniela.resultados[index] = alternativo;
      
      quiniela.resultados = this.ajustarEmpates(quiniela.resultados, partidosClasificados);
      quiniela.empates = quiniela.resultados.filter(r => r === 'E').length;
      quiniela.prob_11_plus = this.calcularProb11Plus(quiniela.resultados, partidosClasificados);
      quiniela.distribucion = this.calcularDistribucion(quiniela.resultados);
    }
    
    return nuevoPortafolio;
  }
}

class PortfolioValidator {
  // Source: Metodología Definitiva Progol.docx 
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
    this.calcularMetricas(quinielas, validacion);

    if (validacion.errores.length > 0) {
      validacion.es_valido = false;
    }

    return validacion;
  }

  // Source: Metodología Definitiva Progol.docx 
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
      // Source: Metodología Definitiva Progol.docx 
      const [minVal, maxVal] = PROGOL_CONFIG.RANGOS_HISTORICOS[resultado];

      if (proporcion < minVal || proporcion > maxVal) {
        // This is a hard constraint now, so it generates an error
        validacion.errores.push(
          `Distribución global de '${resultado}' (${(proporcion * 100).toFixed(1)}%) fuera del rango [${(minVal * 100).toFixed(1)}% - ${(maxVal * 100).toFixed(1)}%]`
        );
      }
    });
  }

  // Source: Metodología Definitiva Progol.docx 
  validarEmpatesIndividuales(quinielas, validacion) {
    quinielas.forEach((quiniela, i) => {
      const empates = quiniela.resultados.filter(r => r === 'E').length;

      if (empates < PROGOL_CONFIG.EMPATES_MIN || empates > PROGOL_CONFIG.EMPATES_MAX) {
        validacion.errores.push(`Quiniela ${quiniela.id || i+1} tiene ${empates} empates, fuera del rango [${PROGOL_CONFIG.EMPATES_MIN}-${PROGOL_CONFIG.EMPATES_MAX}]`);
      }
    });
  }

  // Source: Metodología Definitiva Progol.docx 
  validarConcentracion(quinielas, validacion) {
    const numQuinielas = quinielas.length;
    if (numQuinielas < 2) return; // Concentration not meaningful for a single quiniela

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
        const resultadoConcentrado = Object.keys(conteos).reduce((a, b) => 
          conteos[a] > conteos[b] ? a : b
        );
        validacion.errores.push(
          `Exceso de concentración en Partido ${partidoIdx + 1}: ${(maxConcentracion * 100).toFixed(0)}% en '${resultadoConcentrado}' (límite: ${(limiteAplicable * 100).toFixed(0)}%)`
        );
      }
    }
  }

  calcularMetricas(quinielas, validacion) {
    if (quinielas.length === 0) return;

    const probs11Plus = quinielas.map(q => q.prob_11_plus || 0);
    
    validacion.metricas.prob_11_plus_promedio = probs11Plus.reduce((a, b) => a + b, 0) / probs11Plus.length;
    validacion.metricas.prob_11_plus_max = Math.max(...probs11Plus);
    validacion.metricas.prob_11_plus_min = Math.min(...probs11Plus);

    // Source: Metodología Definitiva Progol.docx 
    const probPortafolio = 1 - probs11Plus.reduce((acc, prob) => acc * (1 - prob), 1);
    validacion.metricas.prob_portafolio_11_plus = probPortafolio;

    const costoTotal = quinielas.length * 15;
    validacion.metricas.costo_total = costoTotal;
    validacion.metricas.eficiencia = probPortafolio / (costoTotal / 1000);
  }
}


// ==================== DATOS DE MUESTRA ====================

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
      const rand = Math.random();
      const probLocal = 0.25 + rand * 0.3;
      const probEmpate = 0.2 + rand * 0.2;
      const probVisitante = 1 - probLocal - probEmpate;

      return {
        local,
        visitante,
        prob_local: probLocal,
        prob_empate: probEmpate,
        prob_visitante: probVisitante,
        es_final: withFinals && (i === 0 || i === 2),
        // Source: Metodología Definitiva Progol.docx 
        forma_diferencia: Math.floor((Math.random() - 0.5) * 4),
        lesiones_impact: Math.floor((Math.random() - 0.5) * 2)
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
    iteracionesOptimizador: 5000,
    temperaturaInicial: 0.80,
    tasaEnfriamiento: 0.995,
    simulacionesMonteCarlo: 5000
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
      await new Promise(resolve => setTimeout(resolve, 500));
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
      await new Promise(resolve => setTimeout(resolve, 500));
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
    if (quinielasCore.length === 0) {
      alert('Necesitas generar las quinielas Core primero');
      return;
    }

    setLoading(true);
    setOptimizationProgress({ phase: 'Inicio', message: 'Iniciando...', iteracion: 0, score: 0, porcentaje: 0 });
    
    try {
      const generator = new PortfolioGenerator(42, config);
      const validator = new PortfolioValidator();
      
      const quinielasParaOptimizar = [...quinielasCore, ...quinielasSatelites];
      
      await new Promise(resolve => {
        // Use setTimeout to allow UI to update before blocking with intense computation
        setTimeout(() => {
          const quinielasOptimizadas = generator.optimizePortfolioGRASPAnnealing(
            quinielasCore, // Pass only Core to start the GRASP construction
            partidosClasificados,
            (progress) => {
              setOptimizationProgress(progress);
            }
          );
          
          const resultadoValidacion = validator.validatePortfolio(quinielasOptimizadas);
          
          setQuinielasFinales(quinielasOptimizadas);
          setValidacion(resultadoValidacion);
          
          resolve(resultadoValidacion);
        }, 100);
      }).then((resultadoValidacion) => {
        if (resultadoValidacion?.es_valido) {
            alert(`✅ Optimización completada!\n🎯 Pr[≥11] Portafolio: ${(resultadoValidacion.metricas.prob_portafolio_11_plus * 100).toFixed(1)}%`);
        } else {
            alert(`⚠️ Optimización completada con errores de validación. Revise los resultados. Errores: ${resultadoValidacion.errores.slice(0, 2).join(', ')}`);
        }
      });

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
        const lines = csv.split(/[\r\n]+/).filter(line => line.trim() && !line.startsWith('#'));
        const headers = lines[0].split(',').map(h => h.trim());
        
        const partidos = [];
        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(',').map(v => v.trim());
          if (values.length >= 5) {
            const prob_local = parseFloat(values[2]);
            const prob_empate = parseFloat(values[3]);
            const prob_visitante = parseFloat(values[4]);
            const probTotal = prob_local + prob_empate + prob_visitante;
            
            partidos.push({
              local: values[0],
              visitante: values[1],
              prob_local: prob_local / probTotal,
              prob_empate: prob_empate / probTotal,
              prob_visitante: prob_visitante / probTotal,
              es_final: (values[5] || 'false').toLowerCase() === 'true',
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
        console.error("Error parsing CSV:", error);
        alert('Error procesando el archivo CSV. Verifique el formato.');
      }
    };
    reader.readAsText(file);
  }, []);

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
              <span className="text-gray-500">v1.1.0 (Fixed)</span>
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
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-md font-medium transition-colors ${
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

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white rounded-lg shadow-sm border">
                <div className="p-6">
                  <h3 className="text-lg font-semibold mb-2">⚽ Partidos Regulares</h3>
                  <p className="text-gray-600 mb-4">Ligas principales y competencias europeas (14 partidos)</p>
                  
                  {partidosRegular.length > 0 ? (
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {partidosRegular.map((partido, i) => (
                        <div key={i} className="flex justify-between items-center p-2 bg-gray-50 rounded text-sm">
                          <span className="font-medium">{partido.local} vs {partido.visitante}</span>
                          <span className="text-gray-600">
                            {(partido.prob_local * 100).toFixed(0)}%-{(partido.prob_empate * 100).toFixed(0)}%-{(partido.prob_visitante * 100).toFixed(0)}%
                            {partido.es_final && <span className="ml-1 text-red-500">🏆</span>}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-gray-500">
                      <Database className="w-12 h-12 mx-auto mb-4 opacity-50" />
                      <p>No hay partidos regulares cargados</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-white rounded-lg shadow-sm border">
                <div className="p-6">
                  <h3 className="text-lg font-semibold mb-2">🏆 Partidos Revancha</h3>
                  <p className="text-gray-600 mb-4">Clásicos latinoamericanos y derbis (7 partidos)</p>
                  
                  {partidosRevancha.length > 0 ? (
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {partidosRevancha.map((partido, i) => (
                        <div key={i} className="flex justify-between items-center p-2 bg-gray-50 rounded text-sm">
                          <span className="font-medium">{partido.local} vs {partido.visitante}</span>
                          <span className="text-gray-600">
                            {(partido.prob_local * 100).toFixed(0)}%-{(partido.prob_empate * 100).toFixed(0)}%-{(partido.prob_visitante * 100).toFixed(0)}%
                            {partido.es_final && <span className="ml-1 text-red-500">🏆</span>}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-gray-500">
                      <Database className="w-12 h-12 mx-auto mb-4 opacity-50" />
                      <p>No hay partidos de revancha cargados</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {partidosRegular.length >= 14 && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <div className="flex items-center gap-2 text-green-700">
                  <CheckCircle2 className="w-5 h-5" />
                  <span className="font-medium">¡Listo para continuar!</span>
                  <span className="text-sm">Tienes suficientes partidos para generar las quinielas</span>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'generacion' && (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-sm border">
              <div className="p-6">
                <h2 className="text-xl font-semibold mb-2 flex items-center gap-2">
                  <Zap className="w-5 h-5" />
                  Generación de Portafolio
                </h2>
                <p className="text-gray-600 mb-6">
                  Sigue la metodología Core + Satélites con optimización GRASP-Annealing
                </p>
                
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                  <div className="text-center">
                    <div className="text-lg font-bold">{config.numQuinielas}</div>
                    <div className="text-sm text-gray-600">Quinielas Target</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold">{config.empatesMin}-{config.empatesMax}</div>
                    <div className="text-sm text-gray-600">Empates por Quiniela</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold">{(config.concentracionGeneral * 100).toFixed(0)}%</div>
                    <div className="text-sm text-gray-600">Concentración Máx</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold">{partidosClasificados.length}</div>
                    <div className="text-sm text-gray-600">Partidos Clasificados</div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <button
                    onClick={clasificarPartidos}
                    disabled={partidosRegular.length < 14 || loading}
                    className={`flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-medium transition-colors ${
                      partidosRegular.length >= 14 && !loading
                        ? 'bg-blue-600 text-white hover:bg-blue-700'
                        : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    }`}
                  >
                    <Brain className="w-4 h-4" />
                    {loading && activeTab === 'generacion' ? 'Clasificando...' : '1. Clasificar Partidos'}
                  </button>

                  <button
                    onClick={generarQuinielasCore}
                    disabled={partidosClasificados.length === 0 || loading}
                    className={`flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-medium transition-colors ${
                      partidosClasificados.length > 0 && !loading
                        ? 'bg-green-600 text-white hover:bg-green-700'
                        : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    }`}
                  >
                    <Target className="w-4 h-4" />
                    {loading && activeTab === 'generacion' ? 'Generando...' : '2. Generar Core (4)'}
                  </button>

                  <button
                    onClick={generarQuinielasSatelites}
                    disabled={quinielasCore.length === 0 || loading}
                    className={`flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-medium transition-colors ${
                      quinielasCore.length > 0 && !loading
                        ? 'bg-purple-600 text-white hover:bg-purple-700'
                        : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    }`}
                  >
                    <RefreshCw className="w-4 h-4" />
                    {loading && activeTab === 'generacion' ? 'Generando...' : `3. Generar Satélites (${config.numQuinielas - 4})`}
                  </button>

                  <button
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    className="flex items-center justify-center gap-2 px-4 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
                  >
                    <Settings className="w-4 h-4" />
                    {showAdvanced ? 'Ocultar Config' : 'Config. Avanzada'}
                  </button>
                </div>
              </div>
            </div>

            {showAdvanced && (
              <div className="bg-orange-50 border border-orange-200 rounded-lg">
                <div className="p-6">
                  <h3 className="text-lg font-semibold mb-2 flex items-center gap-2 text-orange-700">
                    <Gauge className="w-5 h-5" />
                    Parámetros de Optimización (GRASP-Annealing)
                  </h3>
                  <p className="text-gray-600 mb-6">
                    Ajustes avanzados para el algoritmo de optimización. Se recomienda precaución.
                  </p>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Número de quinielas: {config.numQuinielas}
                      </label>
                      <input
                        type="range"
                        min="5"
                        max="40"
                        value={config.numQuinielas}
                        onChange={(e) => setConfig(prev => ({ ...prev, numQuinielas: parseInt(e.target.value) }))}
                        className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Iteraciones del optimizador: {config.iteracionesOptimizador}
                      </label>
                      <input
                        type="range"
                        min="1000"
                        max="10000"
                        step="500"
                        value={config.iteracionesOptimizador}
                        onChange={(e) => setConfig(prev => ({ ...prev, iteracionesOptimizador: parseInt(e.target.value) }))}
                        className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Simulaciones Monte Carlo: {config.simulacionesMonteCarlo}
                      </label>
                      <input
                        type="range"
                        min="1000"
                        max="10000"
                        step="500"
                        value={config.simulacionesMonteCarlo}
                        onChange={(e) => setConfig(prev => ({ ...prev, simulacionesMonteCarlo: parseInt(e.target.value) }))}
                        className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                  </div>

                  <div className="pt-6 mt-6 border-t border-orange-200">
                    <button
                      onClick={ejecutarOptimizacionAvanzada}
                      disabled={quinielasCore.length === 0 || loading}
                      className={`w-full flex items-center justify-center gap-2 px-6 py-4 rounded-lg font-bold text-lg transition-colors ${
                        quinielasCore.length > 0 && !loading
                          ? 'bg-red-600 text-white hover:bg-red-700 shadow-lg'
                          : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                      }`}
                    >
                      <Zap className="w-6 h-6" />
                      {loading ? 'Ejecutando Optimización...' : '🚀 4. Iniciar Optimización Definitiva'}
                    </button>
                    <p className="text-center text-sm text-orange-600 mt-2">
                      Este proceso es intensivo. Ejecutará el algoritmo GRASP-Annealing completo.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {optimizationProgress && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Zap className="w-4 h-4 text-blue-600 animate-pulse" />
                  <span className="font-medium text-blue-700">Optimización en progreso...</span>
                </div>
                <div className="text-sm text-blue-700 font-semibold mb-2">{optimizationProgress.phase}: {optimizationProgress.message}</div>
                <div className="w-full bg-blue-200 rounded-full h-3">
                  <div 
                    className="bg-blue-600 h-3 rounded-full transition-all duration-300"
                    style={{ width: `${optimizationProgress.porcentaje}%` }}
                  />
                </div>
                <div className="text-xs text-blue-600 mt-2">
                  {optimizationProgress.phase === 'Annealing' ? 
                    `Iteración ${optimizationProgress.iteracion} - Score: ${optimizationProgress.score.toFixed(4)} - ${optimizationProgress.porcentaje.toFixed(1)}%` :
                    `${optimizationProgress.porcentaje.toFixed(1)}% completado`
                  }
                </div>
              </div>
            )}

            {partidosClasificados.length > 0 && (
              <div className="bg-white rounded-lg shadow-sm border">
                <div className="p-6">
                  <h3 className="text-lg font-semibold mb-4">🎯 Clasificación de Partidos</h3>
                  
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                    {['Ancla', 'Divisor', 'TendenciaEmpate', 'Neutro'].map(tipo => {
                      const count = partidosClasificados.filter(p => p.clasificacion === tipo).length;
                      const color = {
                        'Ancla': 'text-red-600',
                        'Divisor': 'text-yellow-600',
                        'TendenciaEmpate': 'text-blue-600',
                        'Neutro': 'text-gray-600'
                      }[tipo];
                      
                      return (
                        <div key={tipo} className="text-center p-2 rounded-lg bg-gray-50">
                          <div className={`text-2xl font-bold ${color}`}>{count}</div>
                          <div className="text-sm text-gray-600">{tipo}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className={`bg-white rounded-lg shadow-sm border p-4 text-center ${quinielasCore.length > 0 ? 'border-green-200 bg-green-50' : ''}`}>
                <Target className={`w-8 h-8 mx-auto mb-2 ${quinielasCore.length > 0 ? 'text-green-600' : 'text-gray-400'}`} />
                <div className={`font-medium ${quinielasCore.length > 0 ? 'text-green-700' : 'text-gray-600'}`}>
                  Quinielas Core: {quinielasCore.length}/4
                </div>
              </div>

              <div className={`bg-white rounded-lg shadow-sm border p-4 text-center ${quinielasSatelites.length > 0 ? 'border-purple-200 bg-purple-50' : ''}`}>
                <RefreshCw className={`w-8 h-8 mx-auto mb-2 ${quinielasSatelites.length > 0 ? 'text-purple-600' : 'text-gray-400'}`} />
                <div className={`font-medium ${quinielasSatelites.length > 0 ? 'text-purple-700' : 'text-gray-600'}`}>
                  Quinielas Satélites: {quinielasSatelites.length}/{config.numQuinielas - 4}
                </div>
              </div>

              <div className={`bg-white rounded-lg shadow-sm border p-4 text-center ${quinielasFinales.length > 0 ? 'border-red-200 bg-red-50' : ''}`}>
                <CheckCircle2 className={`w-8 h-8 mx-auto mb-2 ${quinielasFinales.length > 0 ? 'text-red-600' : 'text-gray-400'}`} />
                <div className={`font-medium ${quinielasFinales.length > 0 ? 'text-red-700' : 'text-gray-600'}`}>
                  Portafolio Final: {quinielasFinales.length}/{config.numQuinielas}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'resultados' && (
          <div className="space-y-6">
            {quinielasFinales.length === 0 ? (
              <div className="bg-white rounded-lg shadow-sm border p-8 text-center">
                <BarChart3 className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                <h3 className="text-lg font-medium text-gray-600 mb-2">No hay resultados aún</h3>
                <p className="text-gray-500">Completa la generación y optimización para ver el análisis</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-white rounded-lg shadow-sm border p-4 text-center">
                    <div className="text-2xl font-bold text-blue-600">{quinielasFinales.length}</div>
                    <div className="text-sm text-gray-600">Total Quinielas</div>
                  </div>
                  
                  <div className="bg-white rounded-lg shadow-sm border p-4 text-center">
                    <div className="text-2xl font-bold text-green-600">
                      {(quinielasFinales.reduce((acc, q) => acc + q.resultados.filter(r => r === 'E').length, 0) / quinielasFinales.length).toFixed(1)}
                    </div>
                    <div className="text-sm text-gray-600">Empates Promedio</div>
                  </div>
                  
                  <div className="bg-white rounded-lg shadow-sm border p-4 text-center">
                    <div className="text-2xl font-bold text-purple-600">
                      {(quinielasFinales.reduce((acc, q) => acc + (q.prob_11_plus || 0), 0) / quinielasFinales.length * 100).toFixed(1)}%
                    </div>
                    <div className="text-sm text-gray-600">Pr[≥11] Promedio</div>
                  </div>
                  
                  <div className="bg-white rounded-lg shadow-sm border p-4 text-center">
                    <div className="text-2xl font-bold text-red-600">
                      {validacion?.metricas?.prob_portafolio_11_plus ? 
                        (validacion.metricas.prob_portafolio_11_plus * 100).toFixed(1) : '0.0'}%
                    </div>
                    <div className="text-sm text-gray-600">Pr[≥11] Portafolio</div>
                  </div>
                </div>

                <div className="bg-white rounded-lg shadow-sm border">
                  <div className="p-6">
                    <h3 className="text-lg font-semibold mb-4">📊 Distribución vs Histórico</h3>
                    
                    <div className="grid grid-cols-3 gap-4">
                      {['L', 'E', 'V'].map(resultado => {
                        const actual = validacion?.metricas?.distribucion_global?.[resultado] || 0;
                        const target = PROGOL_CONFIG.DISTRIBUCION_HISTORICA[resultado];
                        const [min, max] = PROGOL_CONFIG.RANGOS_HISTORICOS[resultado];
                        const enRango = actual >= min && actual <= max;
                        
                        return (
                          <div key={resultado} className="text-center p-2 rounded-lg bg-gray-50">
                            <div className={`text-lg font-bold ${enRango ? 'text-green-600' : 'text-red-600'}`}>
                              {(actual * 100).toFixed(1)}%
                            </div>
                            <div className="text-sm text-gray-600">
                              {resultado === 'L' ? 'Locales' : resultado === 'E' ? 'Empates' : 'Visitantes'}
                            </div>
                            <div className="text-xs text-gray-500">
                              Rango: ({(min * 100).toFixed(0)}-{(max * 100).toFixed(0)}%)
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {validacion && (
                  <div className="bg-white rounded-lg shadow-sm border">
                    <div className="p-6">
                      <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                        {validacion.es_valido ? (
                          <CheckCircle2 className="w-5 h-5 text-green-600" />
                        ) : (
                           <div className="w-5 h-5 bg-red-500 rounded-full flex items-center justify-center text-white font-bold text-sm">!</div>
                        )}
                        Estado de Validación del Portafolio
                      </h3>
                      
                      <div className={`p-4 rounded-lg ${validacion.es_valido ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                        <div className={`font-medium ${validacion.es_valido ? 'text-green-700' : 'text-red-700'}`}>
                          {validacion.es_valido ? '✅ Portafolio Válido' : '❌ Portafolio Inválido'}
                        </div>
                        
                        {validacion.warnings.length > 0 && (
                          <div className="mt-2">
                            <div className="text-sm font-medium text-yellow-700 mb-1">Advertencias:</div>
                            <ul className="text-sm text-yellow-600 list-disc list-inside">
                              {validacion.warnings.map((warning, i) => (
                                <li key={i}>{warning}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        
                        {validacion.errores.length > 0 && (
                          <div className="mt-2">
                            <div className="text-sm font-medium text-red-700 mb-1">Errores:</div>
                            <ul className="text-sm text-red-600 list-disc list-inside">
                              {validacion.errores.map((error, i) => (
                                <li key={i}>{error}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                <div className="bg-white rounded-lg shadow-sm border">
                  <div className="p-6">
                    <h3 className="text-lg font-semibold mb-4">📋 Portafolio Final de Quinielas</h3>
                    
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left p-2">#</th>
                            <th className="text-left p-2">Tipo</th>
                            {Array.from({length: 14}, (_, i) => (
                              <th key={i} className="text-center p-1 w-8">P{i+1}</th>
                            ))}
                            <th className="text-center p-2">E</th>
                            <th className="text-center p-2">Pr≥11</th>
                          </tr>
                        </thead>
                        <tbody>
                          {quinielasFinales.map((quiniela, i) => (
                            <tr key={i} className="border-b hover:bg-gray-50">
                              <td className="p-2 font-medium">{quiniela.id}</td>
                              <td className={`p-2 text-xs font-semibold ${
                                quiniela.tipo === 'Core' ? 'text-green-600' : 'text-purple-600'
                              }`}>
                                {quiniela.tipo}
                              </td>
                              {quiniela.resultados.map((resultado, j) => (
                                <td key={j} className={`text-center p-1 font-mono ${
                                  resultado === 'L' ? 'text-blue-600' :
                                  resultado === 'E' ? 'text-gray-600' : 'text-red-600'
                                }`}>
                                  {resultado}
                                </td>
                              ))}
                              <td className="text-center p-2">{quiniela.empates}</td>
                              <td className="text-center p-2">{((quiniela.prob_11_plus || 0) * 100).toFixed(1)}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === 'exportacion' && (
          <div className="space-y-6">
            {quinielasFinales.length === 0 ? (
              <div className="bg-white rounded-lg shadow-sm border p-8 text-center">
                <FileDown className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                <h3 className="text-lg font-medium text-gray-600 mb-2">No hay datos para exportar</h3>
                <p className="text-gray-500">Genera y optimiza un portafolio para poder exportarlo</p>
              </div>
            ) : (
              <>
                <div className="bg-white rounded-lg shadow-sm border">
                  <div className="p-6">
                    <h2 className="text-xl font-semibold mb-2 flex items-center gap-2">
                      <FileDown className="w-5 h-5" />
                      Exportación de Resultados
                    </h2>
                    <p className="text-gray-600 mb-6">
                      Descarga el portafolio final en diferentes formatos.
                    </p>
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <button
                        onClick={() => {
                          const csvContent = generateCSVExport(quinielasFinales);
                          downloadFile(csvContent, 'progol_optimizer_portafolio.csv', 'text/csv');
                        }}
                        className="flex items-center justify-center gap-2 px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                      >
                        <FileDown className="w-4 h-4" />
                        Descargar CSV
                      </button>
                      
                      <button
                        onClick={() => {
                          const jsonContent = generateJSONExport(quinielasFinales, partidosRegular, validacion);
                          downloadFile(jsonContent, 'progol_optimizer_portafolio.json', 'application/json');
                        }}
                        className="flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                      >
                        <FileDown className="w-4 h-4" />
                        Descargar JSON
                      </button>
                      
                      <button
                        onClick={() => {
                          const txtContent = generateProgolFormat(quinielasFinales, partidosClasificados);
                          downloadFile(txtContent, 'progol_boletos.txt', 'text/plain');
                        }}
                        className="flex items-center justify-center gap-2 px-4 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
                      >
                        <FileDown className="w-4 h-4" />
                        Formato Boletos
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ==================== FUNCIONES AUXILIARES ====================

function generateCSVExport(quinielas) {
  const headers = ['ID', 'Tipo', ...Array.from({length: 14}, (_, i) => `P${i+1}`), 'Empates', 'Prob_11_Plus'];
  const rows = quinielas.map(q => [
    q.id,
    q.tipo,
    ...q.resultados,
    q.empates,
    ((q.prob_11_plus || 0) * 100).toFixed(2) + '%'
  ]);
  
  return [headers, ...rows].map(row => row.join(',')).join('\n');
}

function generateJSONExport(quinielas, partidos, validacion) {
  const exportData = {
    metadata: {
      fecha_generacion: new Date().toISOString(),
      total_quinielas: quinielas.length,
      metodologia: 'Core + Satélites con GRASP-Annealing',
      // Source: Metodología Definitiva Progol.docx 
      distribucion_historica: PROGOL_CONFIG.DISTRIBUCION_HISTORICA
    },
    partidos_clasificados: partidos,
    portafolio_final: quinielas,
    validacion: validacion
  };
  
  return JSON.stringify(exportData, null, 2);
}

function generateProgolFormat(quinielas, partidos) {
  const lines = [
    'PROGOL OPTIMIZER - PORTAFOLIO OPTIMIZADO',
    '='.repeat(50),
    `Generado: ${new Date().toLocaleString()}`,
    `Total quinielas: ${quinielas.length}`,
    '',
    'PARTIDOS:',
    ...partidos.slice(0, 14).map((p, i) => `${String(i+1).padStart(2, ' ')}. ${p.local} vs ${p.visitante}`),
    '',
    'QUINIELAS:',
    ...quinielas.map((q) => {
      const resultados = q.resultados.join(' ');
      const prob = ((q.prob_11_plus || 0) * 100).toFixed(1);
      return `${q.id.padEnd(10)}: ${resultados} | Empates: ${q.empates} | Pr[≥11]: ${prob}%`;
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
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}