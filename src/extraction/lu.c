/** Partial-pivot Gaussian elimination on row-major [A|B]. Input and output are IEEE doubles. */
int lu(double *a, unsigned n, unsigned m, double floor) {
  unsigned stride=n+m;
  for(unsigned k=0;k<n;k++) {
    unsigned pivot=k;
    double best=a[k*stride+k]; if(best<0)best=-best;
    for(unsigned i=k+1;i<n;i++) {
      double v=a[i*stride+k];if(v<0)v=-v;
      if(v>best){best=v;pivot=i;}
    }
    if(!__builtin_isfinite(best)||!(best>=floor))return k+1;
    for(unsigned j=k;j<stride;j++) {
      double t=a[k*stride+j];a[k*stride+j]=a[pivot*stride+j];a[pivot*stride+j]=t;
    }
    for(unsigned i=k+1;i<n;i++) {
      double factor=a[i*stride+k]/a[k*stride+k];
      for(unsigned j=k+1;j<stride;j++)a[i*stride+j]-=factor*a[k*stride+j];
    }
  }
  for(unsigned i=n;i-->0;)for(unsigned j=0;j<m;j++) {
    double v=a[i*stride+n+j];
    for(unsigned k=i+1;k<n;k++)v-=a[i*stride+k]*a[k*stride+n+j];
    a[i*stride+n+j]=v/a[i*stride+i];
  }
  return 0;
}
