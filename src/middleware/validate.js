// ======================
// ✅ MIDDLEWARE DE VALIDAÇÃO GENÉRICO (Zod)
// ======================
export function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const erros = result.error.flatten().fieldErrors;
      return res.status(400).json({
        error: 'Dados inválidos',
        detalhes: erros
      });
    }

    // substitui req.body pelos dados já sanitizados/transformados pelo Zod
    req.body = result.data;
    next();
  };
}

// validação de params (ex: :id numérico)
export function validateParams(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      return res.status(400).json({
        error: 'Parâmetros inválidos',
        detalhes: result.error.flatten().fieldErrors
      });
    }
    req.params = result.data;
    next();
  };
}

// validação de query string
export function validateQuery(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return res.status(400).json({
        error: 'Query inválida',
        detalhes: result.error.flatten().fieldErrors
      });
    }
    req.query = result.data;
    next();
  };
}