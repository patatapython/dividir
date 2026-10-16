export function Button({ variant = 'primary', size = 'md', className = '', ...props }: {
  variant?: 'primary' | 'dark' | 'ghost' | 'danger'; size?: 'md' | 'sm';
} & React.ComponentPropsWithRef<'button'>) {
  const cls = `btn btn--${variant}${size === 'sm' ? ' btn--sm' : ''} ${className}`.trim();
  return <button className={cls} {...props} />;
}
