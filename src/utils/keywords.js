// ---------- HARD SKILLS ----------
export const HARD_SKILLS = [

  // Programming Languages
  "Python","Java","JavaScript","TypeScript","C","C++","C#","Go","Rust",
  "Kotlin","Swift","PHP","Ruby","Scala","MATLAB","R","Dart",

  // Web Development
  "HTML","CSS","React","Next.js","Vue.js","Angular","Node.js",
  "Express.js","REST APIs","GraphQL","Web Applications",
  "Frontend Development","Backend Development","Full Stack Development",
  "Responsive Design","Web Performance","SEO Optimization",

  // Software Engineering
  "Object Oriented Programming",
  "Data Structures",
  "Algorithms",
  "System Design",
  "Design Patterns",
  "Software Architecture",
  "Microservices",
  "Monolithic Architecture",
  "API Development",
  "Application Development",
  "Unit Testing",
  "Integration Testing",
  "Test Automation",
  "Debugging",
  "Code Reviews",
  "Peer Reviews",
  "Version Control",

  // DevOps & Infrastructure
  "Docker","Kubernetes","CI/CD","Jenkins","GitHub Actions",
  "Terraform","Infrastructure as Code",
  "Linux","Shell Scripting",
  "Cloud Infrastructure",
  "Site Reliability Engineering",
  "Monitoring","Logging","Observability",

  // Cloud
  "AWS","Google Cloud Platform","Microsoft Azure",
  "Serverless Architecture","Cloud Deployment",
  "Load Balancing","Auto Scaling",

  // Databases & Data Engineering
  "SQL","PostgreSQL","MySQL","MongoDB","Redis",
  "Database Optimization","Data Modeling",
  "ETL Pipelines","Data Warehousing",
  "Apache Spark","Kafka","Airflow",
  "Big Data","Data Pipelines",

  // AI / ML
  "Machine Learning",
  "Deep Learning",
  "Natural Language Processing",
  "Computer Vision",
  "TensorFlow",
  "PyTorch",
  "Scikit-learn",
  "Feature Engineering",
  "Model Evaluation",
  "MLOps",
  "LLMs",
  "Generative AI",
  "RAG Systems",
  "Prompt Engineering",

  // Security
  "Authentication",
  "Authorization",
  "OAuth",
  "JWT",
  "Cybersecurity",
  "Secure Coding",

  // Mobile
  "Android Development",
  "iOS Development",
  "React Native",
  "Flutter",
  "Mobile Applications",

  // Architecture & Scaling
  "Distributed Systems",
  "High Availability",
  "Scalability",
  "Performance Optimization",
  "Caching",
  "Event Driven Architecture",

  // Agile
  "Agile",
  "Scrum",
  "Agile Development",
  "Proof of Concept",
  "Technical Documentation"
];


// ---------- SOFT SKILLS ----------
export const SOFT_SKILLS = [
  "Communication",
  "Collaboration",
  "Teamwork",
  "Problem Solving",
  "Analytical Thinking",
  "Critical Thinking",
  "Leadership",
  "Ownership",
  "Mentorship",
  "Innovation",
  "Adaptability",
  "Time Management",
  "Organization",
  "Creativity",
  "Decision Making",
  "Cross Functional Collaboration",
  "Stakeholder Management",
  "Planning",
  "Motivation",
  "Initiative",
  "Attention to Detail",
  "Product Thinking",
  "Customer Focus",
  "Continuous Learning"
];


// ---------- AUTO BUILD SKILL GRAPH ----------
// Converts skill list → { SkillName: ["normalized phrase"] }

function buildGraph(list) {
  const graph = {};
  for (const skill of list) {
    graph[skill] = [skill.toLowerCase()];
  }
  return graph;
}

const SKILL_GRAPH = {
  hard: buildGraph(HARD_SKILLS),
  soft: buildGraph(SOFT_SKILLS),

  // keep your existing lightweight "other" category
  other: {
    "Teams": ["team","teams"],
    "Products": ["product","products"],
    "Infrastructure": ["infrastructure"],
    "Operations": ["operations","ops"],
    "People": ["people","users"]
  }
};


const STOPWORDS = new Set([
  "the","a","an","and","or","to","of","in","on","for",
  "with","our","your","you","we","is","are","be","this",
  "that","will","can","should","may"
]);




function normalize(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(w => w && !STOPWORDS.has(w));
}


function detectSkills(tokens, vocab) {

  const detected = new Set();
  const tokenSet = new Set(tokens);

  for (const [skill, synonyms] of Object.entries(vocab)) {

    for (const synonym of synonyms) {

      const parts = synonym.split(" ");

      const match = parts.every(p => tokenSet.has(p));

      if (match) {
        detected.add(skill);
        break;
      }
    }
  }

  return detected;
}


function calcScore(matched, total) {
  if (!total) return 0;
  return Math.round((matched / total) * 100);
}



function impactLabel(category) {
  if (category === "hard") return "High Impact";
  if (category === "soft") return "Medium Impact";
  return "Low Impact";
}

// function detectTitleMatch(jd, resume) {
//   return /software engineer/i.test(jd) &&
//          /software engineer/i.test(resume);
// }

// function detectDegreeGap(jd, resume) {

//   if (/ph\.?d/i.test(jd) && !/ph\.?d/i.test(resume)) {
//     return {
//       status: "gap",
//       message:
//         "Be advised! Your resume shows you have a Master's degree however the job posting prefers a Ph.D."
//     };
//   }

//   return {
//     status: "ok",
//     message: "Congratulations! Your resume matches the degree requirements."
//   };
// }


function formatCategory(category, data) {

  const skills = [];

  // matched skills
  for (const skill of data.matched) {
    skills.push({
      name: skill,
      status: "matched"
    });
  }

  // missing skills
  for (const skill of data.missing) {
    skills.push({
      name: skill,
      status: "missing"
    });
  }

  // optional: alphabetical clean UI
  skills.sort((a, b) => a.name.localeCompare(b.name));

  return {
    impact: impactLabel(category),

    title:
      category === "hard"
        ? "Hard Skills"
        : category === "soft"
        ? "Soft Skills"
        : "Other Skills",

    score: data.score,

    total: skills.length,
    missingCount: data.missing.length,
    skills
  };
}

export function analyzeKeywords(jobDescription, resumeText) {

  const jdTokens = normalize(jobDescription);
  const resumeTokens = normalize(resumeText);

  const results = {};

  for (const category of ["hard","soft","other"]) {

    const jdSkills =
      detectSkills(jdTokens, SKILL_GRAPH[category]);

    const resumeSkills =
      detectSkills(resumeTokens, SKILL_GRAPH[category]);

    const matched =
      [...jdSkills].filter(s => resumeSkills.has(s));

    const missing =
      [...jdSkills].filter(s => !resumeSkills.has(s));

    results[category] = {
      matched,
      missing,
      score: calcScore(matched.length, jdSkills.size)
    };
  }

  return {

    hardSkills: formatCategory("hard", results.hard),
    softSkills: formatCategory("soft", results.soft),
    otherSkills: formatCategory("other", results.other),

    // titleMatch: detectTitleMatch(jobDescription, resumeText),

    // degreeMatch: detectDegreeGap(jobDescription, resumeText)
  };
}