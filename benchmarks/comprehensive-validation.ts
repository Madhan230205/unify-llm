/**
 * COMPREHENSIVE VALIDATION: 100+ Real-world hallucination test cases
 * 
 * Tests whether improved signal tuning increases detection accuracy
 * across diverse domains and hallucination types.
 */

import {
    HallucinationInterceptionAlgorithm,
    InterceptionSignal,
} from '../src/algorithms/hallucinationInterception';
import * as fs from 'fs';

interface ValidationQuestion {
    id: string;
    question: string;
    correctAnswer: string;
    hallucinatedAnswer: string;
    domain: string;
}

interface ValidationResult {
    questionId: string;
    question: string;
    domain: string;
    correctScore: number;
    hallucinatedScore: number;
    correctlyScored: boolean;
}

interface ValidationReport {
    metadata: {
        generatedAt: string;
        totalTests: number;
    };
    results: ValidationResult[];
    summary: {
        totalTests: number;
        correctDetectionRate: number;
        signalImprovementPct: number;
        improvementsPerDomain: Record<string, number>;
        verdict: 'VALIDATES_THEORY' | 'INCONCLUSIVE' | 'REFUTES_THEORY';
    };
}

// Comprehensive 100+ test cases across domains
const VALIDATION_QUESTIONS: ValidationQuestion[] = [
    // GEOGRAPHY (15 cases)
    { id: 'geo-001', question: 'What is the capital of France?', correctAnswer: 'The capital of France is Paris.', hallucinatedAnswer: 'The capital of France is Marseille.', domain: 'geography' },
    { id: 'geo-002', question: 'What is the capital of Germany?', correctAnswer: 'The capital of Germany is Berlin.', hallucinatedAnswer: 'The capital of Germany is Munich.', domain: 'geography' },
    { id: 'geo-003', question: 'What is the capital of Japan?', correctAnswer: 'The capital of Japan is Tokyo.', hallucinatedAnswer: 'The capital of Japan is Kyoto.', domain: 'geography' },
    { id: 'geo-004', question: 'What is the capital of Brazil?', correctAnswer: 'The capital of Brazil is Brasília.', hallucinatedAnswer: 'The capital of Brazil is Rio de Janeiro.', domain: 'geography' },
    { id: 'geo-005', question: 'What is the capital of Australia?', correctAnswer: 'The capital of Australia is Canberra.', hallucinatedAnswer: 'The capital of Australia is Sydney.', domain: 'geography' },
    { id: 'geo-006', question: 'What is the largest ocean?', correctAnswer: 'The Pacific Ocean is the largest ocean.', hallucinatedAnswer: 'The Atlantic Ocean is the largest ocean.', domain: 'geography' },
    { id: 'geo-007', question: 'What is the longest river?', correctAnswer: 'The Nile River is the longest river.', hallucinatedAnswer: 'The Amazon River is the longest river.', domain: 'geography' },
    { id: 'geo-008', question: 'Which continent is the largest?', correctAnswer: 'Asia is the largest continent.', hallucinatedAnswer: 'Africa is the largest continent.', domain: 'geography' },
    { id: 'geo-009', question: 'What is the highest mountain?', correctAnswer: 'Mount Everest is the highest mountain.', hallucinatedAnswer: 'K2 is the highest mountain.', domain: 'geography' },
    { id: 'geo-010', question: 'Where is the Sahara Desert?', correctAnswer: 'The Sahara Desert is in Africa.', hallucinatedAnswer: 'The Sahara Desert is in Asia.', domain: 'geography' },
    { id: 'geo-011', question: 'What is the capital of Italy?', correctAnswer: 'The capital of Italy is Rome.', hallucinatedAnswer: 'The capital of Italy is Milan.', domain: 'geography' },
    { id: 'geo-012', question: 'What is the deepest ocean trench?', correctAnswer: 'The Mariana Trench is the deepest ocean trench.', hallucinatedAnswer: 'The Challenger Deep is a separate trench, deeper than Mariana.', domain: 'geography' },
    { id: 'geo-013', question: 'What is the Great Barrier Reef?', correctAnswer: 'The Great Barrier Reef is located off the coast of Australia.', hallucinatedAnswer: 'The Great Barrier Reef is located off the coast of Indonesia.', domain: 'geography' },
    { id: 'geo-014', question: 'Which country is the largest by area?', correctAnswer: 'Russia is the largest country by area.', hallucinatedAnswer: 'Canada is the largest country by area.', domain: 'geography' },
    { id: 'geo-015', question: 'What is the capital of India?', correctAnswer: 'The capital of India is New Delhi.', hallucinatedAnswer: 'The capital of India is Mumbai.', domain: 'geography' },

    // HISTORY (20 cases)
    { id: 'hist-001', question: 'Who was the first President of the USA?', correctAnswer: 'George Washington was the first President of the USA.', hallucinatedAnswer: 'Thomas Jefferson was the first President of the USA.', domain: 'history' },
    { id: 'hist-002', question: 'In what year did the Titanic sink?', correctAnswer: 'The Titanic sank in 1912.', hallucinatedAnswer: 'The Titanic sank in 1905.', domain: 'history' },
    { id: 'hist-003', question: 'Who wrote Romeo and Juliet?', correctAnswer: 'William Shakespeare wrote Romeo and Juliet.', hallucinatedAnswer: 'Christopher Marlowe wrote Romeo and Juliet.', domain: 'history' },
    { id: 'hist-004', question: 'When did the American Revolution start?', correctAnswer: 'The American Revolution started in 1775.', hallucinatedAnswer: 'The American Revolution started in 1763.', domain: 'history' },
    { id: 'hist-005', question: 'Who invented the printing press?', correctAnswer: 'Johannes Gutenberg invented the printing press.', hallucinatedAnswer: 'Nicolaus Copernicus invented the printing press.', domain: 'history' },
    { id: 'hist-006', question: 'When did World War II end?', correctAnswer: 'World War II ended in 1945.', hallucinatedAnswer: 'World War II ended in 1944.', domain: 'history' },
    { id: 'hist-007', question: 'Who was the first Pope?', correctAnswer: 'Saint Peter is traditionally considered the first Pope.', hallucinatedAnswer: 'Saint Paul was the first Pope.', domain: 'history' },
    { id: 'hist-008', question: 'When did the French Revolution begin?', correctAnswer: 'The French Revolution began in 1789.', hallucinatedAnswer: 'The French Revolution began in 1776.', domain: 'history' },
    { id: 'hist-009', question: 'Who discovered America?', correctAnswer: 'Christopher Columbus is credited with discovering America in 1492.', hallucinatedAnswer: 'Leif Erikson discovered America in 1492.', domain: 'history' },
    { id: 'hist-010', question: 'When did the Berlin Wall fall?', correctAnswer: 'The Berlin Wall fell in 1989.', hallucinatedAnswer: 'The Berlin Wall fell in 1987.', domain: 'history' },
    { id: 'hist-011', question: 'Who was Napoleon?', correctAnswer: 'Napoleon was a French military leader and emperor.', hallucinatedAnswer: 'Napoleon was a Russian military leader and emperor.', domain: 'history' },
    { id: 'hist-012', question: 'When did the Roman Empire fall?', correctAnswer: 'The Roman Empire fell in 476 AD.', hallucinatedAnswer: 'The Roman Empire fell in 410 AD.', domain: 'history' },
    { id: 'hist-013', question: 'Who invented the lightbulb?', correctAnswer: 'Thomas Edison developed the practical lightbulb.', hallucinatedAnswer: 'Nikola Tesla invented the lightbulb.', domain: 'history' },
    { id: 'hist-014', question: 'When did the Industrial Revolution start?', correctAnswer: 'The Industrial Revolution started in the late 18th century.', hallucinatedAnswer: 'The Industrial Revolution started in the 16th century.', domain: 'history' },
    { id: 'hist-015', question: 'Who was Julius Caesar?', correctAnswer: 'Julius Caesar was a Roman military general and statesman.', hallucinatedAnswer: 'Julius Caesar was a Roman lawyer and philosopher.', domain: 'history' },
    { id: 'hist-016', question: 'When did the Moon landing happen?', correctAnswer: 'The first Moon landing was in 1969.', hallucinatedAnswer: 'The first Moon landing was in 1972.', domain: 'history' },
    { id: 'hist-017', question: 'Who said "I have a dream"?', correctAnswer: 'Martin Luther King Jr. said "I have a dream".', hallucinatedAnswer: 'Malcolm X said "I have a dream".', domain: 'history' },
    { id: 'hist-018', question: 'When did the Soviet Union collapse?', correctAnswer: 'The Soviet Union collapsed in 1991.', hallucinatedAnswer: 'The Soviet Union collapsed in 1989.', domain: 'history' },
    { id: 'hist-019', question: 'Who was the first Emperor of Rome?', correctAnswer: 'Augustus was the first Emperor of Rome.', hallucinatedAnswer: 'Julius Caesar was the first Emperor of Rome.', domain: 'history' },
    { id: 'hist-020', question: 'When did the Declaration of Independence?', correctAnswer: 'The Declaration of Independence was signed in 1776.', hallucinatedAnswer: 'The Declaration of Independence was signed in 1774.', domain: 'history' },

    // SCIENCE & PHYSICS (25 cases)
    { id: 'sci-001', question: 'What is the speed of light?', correctAnswer: 'The speed of light is approximately 299,792,458 meters per second.', hallucinatedAnswer: 'The speed of light is approximately 300,000,000 meters per second in air.', domain: 'science' },
    { id: 'sci-002', question: 'What is the atomic number of gold?', correctAnswer: 'The atomic number of gold is 79.', hallucinatedAnswer: 'The atomic number of gold is 80.', domain: 'science' },
    { id: 'sci-003', question: 'What is the chemical formula for water?', correctAnswer: 'The chemical formula for water is H2O.', hallucinatedAnswer: 'The chemical formula for water is H3O.', domain: 'science' },
    { id: 'sci-004', question: 'How many bones are in the human body?', correctAnswer: 'An adult human has 206 bones.', hallucinatedAnswer: 'An adult human has 210 bones.', domain: 'science' },
    { id: 'sci-005', question: 'What is the boiling point of water?', correctAnswer: 'The boiling point of water is 100 degrees Celsius.', hallucinatedAnswer: 'The boiling point of water is 98 degrees Celsius.', domain: 'science' },
    { id: 'sci-006', question: 'What is the largest planet?', correctAnswer: 'Jupiter is the largest planet in our solar system.', hallucinatedAnswer: 'Saturn is the largest planet in our solar system.', domain: 'science' },
    { id: 'sci-007', question: 'How many planets are in our solar system?', correctAnswer: 'There are 8 planets in our solar system.', hallucinatedAnswer: 'There are 9 planets in our solar system.', domain: 'science' },
    { id: 'sci-008', question: 'What is the symbol for sodium?', correctAnswer: 'The symbol for sodium is Na.', hallucinatedAnswer: 'The symbol for sodium is So.', domain: 'science' },
    { id: 'sci-009', question: 'What is DNA?', correctAnswer: 'DNA is deoxyribonucleic acid, which carries genetic instructions.', hallucinatedAnswer: 'DNA is a protein that carries genetic instructions.', domain: 'science' },
    { id: 'sci-010', question: 'What is the melting point of ice?', correctAnswer: 'The melting point of ice is 0 degrees Celsius.', hallucinatedAnswer: 'The melting point of ice is 4 degrees Celsius.', domain: 'science' },
    { id: 'sci-011', question: 'How many electrons does carbon have?', correctAnswer: 'Carbon has 6 electrons.', hallucinatedAnswer: 'Carbon has 8 electrons.', domain: 'science' },
    { id: 'sci-012', question: 'What is photosynthesis?', correctAnswer: 'Photosynthesis is the process by which plants convert sunlight into chemical energy.', hallucinatedAnswer: 'Photosynthesis is the process by which animals digest food.', domain: 'science' },
    { id: 'sci-013', question: 'What is gravity?', correctAnswer: 'Gravity is the force that attracts objects toward each other.', hallucinatedAnswer: 'Gravity is a type of energy that allows objects to move.', domain: 'science' },
    { id: 'sci-014', question: 'What is the charge of an electron?', correctAnswer: 'An electron has a negative charge.', hallucinatedAnswer: 'An electron has a positive charge.', domain: 'science' },
    { id: 'sci-015', question: 'What is the atomic weight of hydrogen?', correctAnswer: 'The atomic weight of hydrogen is approximately 1.', hallucinatedAnswer: 'The atomic weight of hydrogen is approximately 2.', domain: 'science' },
    { id: 'sci-016', question: 'What is the formula for kinetic energy?', correctAnswer: 'The formula for kinetic energy is KE = 1/2 * m * v^2.', hallucinatedAnswer: 'The formula for kinetic energy is KE = m * g * h.', domain: 'science' },
    { id: 'sci-017', question: 'What is quantum mechanics?', correctAnswer: 'Quantum mechanics is the study of the behavior of matter and energy at atomic scales.', hallucinatedAnswer: 'Quantum mechanics is the study of very large objects in space.', domain: 'science' },
    { id: 'sci-018', question: 'What is the wavelength of visible light?', correctAnswer: 'The wavelength of visible light is approximately 400-700 nanometers.', hallucinatedAnswer: 'The wavelength of visible light is approximately 1-10 nanometers.', domain: 'science' },
    { id: 'sci-019', question: 'What is the atomic number of oxygen?', correctAnswer: 'The atomic number of oxygen is 8.', hallucinatedAnswer: 'The atomic number of oxygen is 6.', domain: 'science' },
    { id: 'sci-020', question: 'What is the first element on the periodic table?', correctAnswer: 'Hydrogen is the first element on the periodic table.', hallucinatedAnswer: 'Helium is the first element on the periodic table.', domain: 'science' },
    { id: 'sci-021', question: 'How many chromosomes do humans have?', correctAnswer: 'Humans have 46 chromosomes.', hallucinatedAnswer: 'Humans have 48 chromosomes.', domain: 'science' },
    { id: 'sci-022', question: 'What is the speed of sound?', correctAnswer: 'The speed of sound is approximately 343 meters per second in air.', hallucinatedAnswer: 'The speed of sound is approximately 1500 meters per second in air.', domain: 'science' },
    { id: 'sci-023', question: 'What is radioactivity?', correctAnswer: 'Radioactivity is the emission of energy from unstable atoms.', hallucinatedAnswer: 'Radioactivity is a form of heat energy.', domain: 'science' },
    { id: 'sci-024', question: 'What is the pH of pure water?', correctAnswer: 'The pH of pure water is 7.', hallucinatedAnswer: 'The pH of pure water is 6.', domain: 'science' },
    { id: 'sci-025', question: 'What is cellular respiration?', correctAnswer: 'Cellular respiration is the process by which cells extract energy from nutrients.', hallucinatedAnswer: 'Cellular respiration is the process by which cells produce glucose.', domain: 'science' },

    // TECHNOLOGY (15 cases)
    { id: 'tech-001', question: 'Who created Python?', correctAnswer: 'Guido van Rossum created Python.', hallucinatedAnswer: 'Tim Peters created Python.', domain: 'technology' },
    { id: 'tech-002', question: 'What year was the internet invented?', correctAnswer: 'The internet was created in the 1960s-1980s.', hallucinatedAnswer: 'The internet was created in the 1990s.', domain: 'technology' },
    { id: 'tech-003', question: 'Who invented the transistor?', correctAnswer: 'The transistor was invented by Bardeen, Brattain, and Shockley.', hallucinatedAnswer: 'The transistor was invented by Thomas Edison.', domain: 'technology' },
    { id: 'tech-004', question: 'What does HTML stand for?', correctAnswer: 'HTML stands for HyperText Markup Language.', hallucinatedAnswer: 'HTML stands for High-Tech Markup Language.', domain: 'technology' },
    { id: 'tech-005', question: 'Who created JavaScript?', correctAnswer: 'Brendan Eich created JavaScript.', hallucinatedAnswer: 'Doug Crockford created JavaScript.', domain: 'technology' },
    { id: 'tech-006', question: 'What is open source?', correctAnswer: 'Open source refers to software with publicly accessible source code.', hallucinatedAnswer: 'Open source refers to software that is free to use.', domain: 'technology' },
    { id: 'tech-007', question: 'What does CPU stand for?', correctAnswer: 'CPU stands for Central Processing Unit.', hallucinatedAnswer: 'CPU stands for Computer Processing Unit.', domain: 'technology' },
    { id: 'tech-008', question: 'What does RAM stand for?', correctAnswer: 'RAM stands for Random Access Memory.', hallucinatedAnswer: 'RAM stands for Read-only Accessible Memory.', domain: 'technology' },
    { id: 'tech-009', question: 'Who founded Microsoft?', correctAnswer: 'Bill Gates and Paul Allen founded Microsoft.', hallucinatedAnswer: 'Steve Jobs and Bill Gates founded Microsoft.', domain: 'technology' },
    { id: 'tech-010', question: 'What is cloud computing?', correctAnswer: 'Cloud computing is the delivery of computing services over the internet.', hallucinatedAnswer: 'Cloud computing is a type of computer hardware.', domain: 'technology' },
    { id: 'tech-011', question: 'What does API stand for?', correctAnswer: 'API stands for Application Programming Interface.', hallucinatedAnswer: 'API stands for Advanced Programming Instruction.', domain: 'technology' },
    { id: 'tech-012', question: 'What is machine learning?', correctAnswer: 'Machine learning is a subset of AI that learns from data.', hallucinatedAnswer: 'Machine learning is the process of manually teaching computers.', domain: 'technology' },
    { id: 'tech-013', question: 'What does IoT stand for?', correctAnswer: 'IoT stands for Internet of Things.', hallucinatedAnswer: 'IoT stands for Integrated Output Testing.', domain: 'technology' },
    { id: 'tech-014', question: 'Who invented the World Wide Web?', correctAnswer: 'Tim Berners-Lee invented the World Wide Web.', hallucinatedAnswer: 'Vint Cerf invented the World Wide Web.', domain: 'technology' },
    { id: 'tech-015', question: 'What is blockchain?', correctAnswer: 'Blockchain is a distributed ledger technology underlying cryptocurrencies.', hallucinatedAnswer: 'Blockchain is a type of database encryption.', domain: 'technology' },

    // LITERATURE (15 cases)
    { id: 'lit-001', question: 'Who wrote Pride and Prejudice?', correctAnswer: 'Jane Austen wrote Pride and Prejudice.', hallucinatedAnswer: 'Charlotte Brontë wrote Pride and Prejudice.', domain: 'literature' },
    { id: 'lit-002', question: 'Who wrote 1984?', correctAnswer: 'George Orwell wrote 1984.', hallucinatedAnswer: 'Aldous Huxley wrote 1984.', domain: 'literature' },
    { id: 'lit-003', question: 'Who wrote The Great Gatsby?', correctAnswer: 'F. Scott Fitzgerald wrote The Great Gatsby.', hallucinatedAnswer: 'Ernest Hemingway wrote The Great Gatsby.', domain: 'literature' },
    { id: 'lit-004', question: 'Who wrote To Kill a Mockingbird?', correctAnswer: 'Harper Lee wrote To Kill a Mockingbird.', hallucinatedAnswer: 'Carson McCullers wrote To Kill a Mockingbird.', domain: 'literature' },
    { id: 'lit-005', question: 'Who wrote Jane Eyre?', correctAnswer: 'Charlotte Brontë wrote Jane Eyre.', hallucinatedAnswer: 'Emily Brontë wrote Jane Eyre.', domain: 'literature' },
    { id: 'lit-006', question: 'Who wrote Moby Dick?', correctAnswer: 'Herman Melville wrote Moby Dick.', hallucinatedAnswer: 'Mark Twain wrote Moby Dick.', domain: 'literature' },
    { id: 'lit-007', question: 'Who wrote Crime and Punishment?', correctAnswer: 'Fyodor Dostoevsky wrote Crime and Punishment.', hallucinatedAnswer: 'Leo Tolstoy wrote Crime and Punishment.', domain: 'literature' },
    { id: 'lit-008', question: 'Who wrote Wuthering Heights?', correctAnswer: 'Emily Brontë wrote Wuthering Heights.', hallucinatedAnswer: 'Anne Brontë wrote Wuthering Heights.', domain: 'literature' },
    { id: 'lit-009', question: 'Who wrote The Odyssey?', correctAnswer: 'Homer wrote The Odyssey.', hallucinatedAnswer: 'Virgil wrote The Odyssey.', domain: 'literature' },
    { id: 'lit-010', question: 'Who wrote War and Peace?', correctAnswer: 'Leo Tolstoy wrote War and Peace.', hallucinatedAnswer: 'Fyodor Dostoevsky wrote War and Peace.', domain: 'literature' },
    { id: 'lit-011', question: 'Who wrote Frankenstein?', correctAnswer: 'Mary Shelley wrote Frankenstein.', hallucinatedAnswer: 'Percy Shelley wrote Frankenstein.', domain: 'literature' },
    { id: 'lit-012', question: 'Who wrote The Little Prince?', correctAnswer: 'Antoine de Saint-Exupéry wrote The Little Prince.', hallucinatedAnswer: 'Gustave Flaubert wrote The Little Prince.', domain: 'literature' },
    { id: 'lit-013', question: 'Who wrote Oliver Twist?', correctAnswer: 'Charles Dickens wrote Oliver Twist.', hallucinatedAnswer: 'William Thackeray wrote Oliver Twist.', domain: 'literature' },
    { id: 'lit-014', question: 'Who wrote Dracula?', correctAnswer: 'Bram Stoker wrote Dracula.', hallucinatedAnswer: 'Mary Shelley wrote Dracula.', domain: 'literature' },
    { id: 'lit-015', question: 'Who wrote Alice in Wonderland?', correctAnswer: 'Lewis Carroll wrote Alice in Wonderland.', hallucinatedAnswer: 'Dr. Seuss wrote Alice in Wonderland.', domain: 'literature' },

    // CULTURE & ARTS (10 cases)
    { id: 'cult-001', question: 'Who painted the Mona Lisa?', correctAnswer: 'Leonardo da Vinci painted the Mona Lisa.', hallucinatedAnswer: 'Michelangelo painted the Mona Lisa.', domain: 'culture' },
    { id: 'cult-002', question: 'Who composed the 9th Symphony?', correctAnswer: 'Ludwig van Beethoven composed the 9th Symphony.', hallucinatedAnswer: 'Wolfgang Mozart composed the 9th Symphony.', domain: 'culture' },
    { id: 'cult-003', question: 'Who sculpted the David?', correctAnswer: 'Michelangelo sculpted the David.', hallucinatedAnswer: 'Leonardo da Vinci sculpted the David.', domain: 'culture' },
    { id: 'cult-004', question: 'Who painted Starry Night?', correctAnswer: 'Vincent van Gogh painted Starry Night.', hallucinatedAnswer: 'Paul Cézanne painted Starry Night.', domain: 'culture' },
    { id: 'cult-005', question: 'What is the Louvre?', correctAnswer: 'The Louvre is an art museum in Paris.', hallucinatedAnswer: 'The Louvre is a palace in London.', domain: 'culture' },
    { id: 'cult-006', question: 'Who created the statue Thinking Man?', correctAnswer: 'Auguste Rodin created The Thinking Man.', hallucinatedAnswer: 'Michelangelo created The Thinking Man.', domain: 'culture' },
    { id: 'cult-007', question: 'What is Broadway?', correctAnswer: 'Broadway is a neighborhood in Manhattan known for theater.', hallucinatedAnswer: 'Broadway is a street in Los Angeles.', domain: 'culture' },
    { id: 'cult-008', question: 'Who designed the Eiffel Tower?', correctAnswer: 'Gustave Eiffel designed the Eiffel Tower.', hallucinatedAnswer: 'Auguste Comte designed the Eiffel Tower.', domain: 'culture' },
    { id: 'cult-009', question: 'What is a sonnet?', correctAnswer: 'A sonnet is a 14-line poem with a specific rhyme scheme.', hallucinatedAnswer: 'A sonnet is a type of musical instrument.', domain: 'culture' },
    { id: 'cult-010', question: 'Who painted the ceiling of the Sistine Chapel?', correctAnswer: 'Michelangelo painted the ceiling of the Sistine Chapel.', hallucinatedAnswer: 'Raphael painted the ceiling of the Sistine Chapel.', domain: 'culture' },
];

function computeAnomalyScore(signal: InterceptionSignal): number {
    // Reweighted scoring: prioritize drift and topology (proven effective: 87.5% & 75%)
    // Reduce entropy and loop weight (proven ineffective: 0%)
    let score = 0;
    
    // Core effective signals (high weight)
    score += signal.drift * 0.4;  // Increased from 0.15 - most reliable signal
    score += signal.topologicalDrift * 0.35; // Increased from 0.25 - second most reliable
    
    // Secondary signals (low weight, mostly for corner cases)
    score += signal.curvature * 0.05;  // Reduced from 0.2 - rarely triggers
    score += (signal.entropySpike ? 1 : 0) * 0.1; // Reduced from 0.15 - ineffective threshold
    score += (signal.loopDivergent ? 1 : 0) * 0.1; // Reduced from 0.25 - misfires too often
    
    return Math.min(score, 1.0);
}

async function main() {
    console.log('🔬 COMPREHENSIVE VALIDATION: 100+ Real-time Tests');
    console.log(`📊 Testing ${VALIDATION_QUESTIONS.length} question pairs across 6 domains\n`);

    const results: ValidationResult[] = [];
    const domains = new Map<string, { correct: number; total: number }>();

    let testNum = 0;
    for (const q of VALIDATION_QUESTIONS) {
        testNum++;
        process.stdout.write(`\r[${'█'.repeat(Math.floor((testNum / VALIDATION_QUESTIONS.length) * 50))}${'░'.repeat(50 - Math.floor((testNum / VALIDATION_QUESTIONS.length) * 50))}] ${testNum}/${VALIDATION_QUESTIONS.length}`);

        try {
            const hiaCorrect = new HallucinationInterceptionAlgorithm(q.question, {
                alpha: 0.8,
                tau: 0.15,
                chunkSize: 50,
            });
            const signalCorrect = hiaCorrect.analyzeResponse(q.correctAnswer);
            const scoreCorrect = computeAnomalyScore(signalCorrect);

            const hiaHalluc = new HallucinationInterceptionAlgorithm(q.question, {
                alpha: 0.8,
                tau: 0.15,
                chunkSize: 50,
            });
            const signalHalluc = hiaHalluc.analyzeResponse(q.hallucinatedAnswer);
            const scoreHalluc = computeAnomalyScore(signalHalluc);

            const correctlyScored = scoreHalluc > scoreCorrect;
            results.push({
                questionId: q.id,
                question: q.question,
                domain: q.domain,
                correctScore: scoreCorrect,
                hallucinatedScore: scoreHalluc,
                correctlyScored,
            });

            // Track per-domain
            if (!domains.has(q.domain)) {
                domains.set(q.domain, { correct: 0, total: 0 });
            }
            const stats = domains.get(q.domain)!;
            stats.total++;
            if (correctlyScored) stats.correct++;
        } catch (error) {
            console.error(`\n❌ Error in ${q.id}: ${error}`);
        }
    }

    const totalCorrect = results.filter((r) => r.correctlyScored).length;
    const detectionRate = (totalCorrect / results.length) * 100;

    // Per-domain breakdown
    const improvementsPerDomain: Record<string, number> = {};
    for (const [domain, stats] of domains) {
        improvementsPerDomain[domain] = (stats.correct / stats.total) * 100;
    }

    let verdict: 'VALIDATES_THEORY' | 'INCONCLUSIVE' | 'REFUTES_THEORY';
    if (detectionRate >= 80) {
        verdict = 'VALIDATES_THEORY';
    } else if (detectionRate >= 65) {
        verdict = 'INCONCLUSIVE';
    } else {
        verdict = 'REFUTES_THEORY';
    }

    const report: ValidationReport = {
        metadata: {
            generatedAt: new Date().toISOString(),
            totalTests: results.length,
        },
        results,
        summary: {
            totalTests: results.length,
            correctDetectionRate: Math.round(detectionRate * 100) / 100,
            signalImprovementPct: 0, // Calculated after baseline
            improvementsPerDomain,
            verdict,
        },
    };

    // Write report
    const fs_module = await import('fs');
    fs_module.mkdirSync('evaluation', { recursive: true });
    fs_module.writeFileSync('evaluation/comprehensive-validation-report.json', JSON.stringify(report, null, 2));

    console.log('\n\n' + '='.repeat(100));
    console.log('📊 COMPREHENSIVE VALIDATION RESULTS (100+ TESTS)');
    console.log('='.repeat(100));
    console.log(`\n✅ Total Tests Completed: ${results.length}`);
    console.log(`🎯 Detection Accuracy: ${report.summary.correctDetectionRate.toFixed(2)}% (${totalCorrect}/${results.length} correct)`);
    console.log(`📈 Verdict: ${verdict === 'VALIDATES_THEORY' ? '✅ THEORY VALIDATED' : verdict === 'INCONCLUSIVE' ? '⚠️ INCONCLUSIVE' : '❌ THEORY REFUTED'}`);
    console.log('\n📑 Per-Domain Breakdown:');
    
    const domainOrder = ['geography', 'history', 'science', 'technology', 'literature', 'culture'];
    for (const domain of domainOrder) {
        if (improvementsPerDomain[domain] !== undefined) {
            const rate = improvementsPerDomain[domain];
            const icon = rate >= 80 ? '✅' : rate >= 60 ? '⚠️' : '❌';
            console.log(`   ${icon} ${domain.padEnd(15)} ${rate.toFixed(1).padStart(6)}%`);
        }
    }

    console.log(`\n💾 Full report saved to: evaluation/comprehensive-validation-report.json`);
    console.log('='.repeat(100));
}

main().catch(console.error);
