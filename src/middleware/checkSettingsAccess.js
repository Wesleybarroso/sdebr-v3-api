export const checkSettingsAccess = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Apenas administradores podem acessar.' });
  }
  
  if (req.user.can_access_settings === false) {
    return res.status(403).json({ 
      error: 'Acesso negado. Este administrador não tem permissão para acessar as configurações do sistema.' 
    });
  }
  next();
};