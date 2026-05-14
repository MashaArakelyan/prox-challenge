// Test script matching the actual definition+handle export pattern
import { handle } from '../lib/agent/tools/get-chassis-metadata.js';

(async () => {
  console.time('chassis-tool');
  const resultStr = handle({ chassisId: 'omnipro_220' });
  console.timeEnd('chassis-tool');

  const result = JSON.parse(resultStr) as Record<string, unknown>;
  console.log('found:', result.found);
  console.log('has metadata:', !!result.metadata);
  console.log('has scaffoldCode:', !!result.scaffoldCode);
  console.log('scaffold length:', typeof result.scaffoldCode === 'string' ? result.scaffoldCode.length : 0);
  console.log('error:', result.error ?? '(none)');
  if (typeof result.scaffoldCode === 'string') {
    console.log('\nFirst 300 chars of scaffold:');
    console.log(result.scaffoldCode.slice(0, 300));
    console.log('\nLast 100 chars of scaffold:');
    console.log(result.scaffoldCode.slice(-100));
  }
})();
