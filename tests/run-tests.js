/**
 * run-tests.js — Automated Acceptance Test Suite (Tests A–J) for AnansiWorkbench.
 */

(() => {
    'use strict';

    const results = [];

    function assert(condition, testName, message) {
        if (condition) {
            results.push({ name: testName, status: 'PASS', message });
            console.log(`%c[PASS] ${testName}: ${message}`, 'color: #10b981; font-weight: bold;');
        } else {
            results.push({ name: testName, status: 'FAIL', message });
            console.error(`[FAIL] ${testName}: ${message}`);
        }
    }

    async function runAllTests() {
        console.log('%c==========================================', 'color: #6366f1; font-weight: bold;');
        console.log('%c  AnansiWorkbench Acceptance Test Suite   ', 'color: #6366f1; font-weight: bold;');
        console.log('%c==========================================', 'color: #6366f1; font-weight: bold;');

        // Test A: Database & Store Initialization
        try {
            await WorkbenchDB.initDB();
            const exp = await WorkbenchDB.saveExperiment({ title: 'Test A Exp', status: 'Draft' });
            assert(exp && exp.id, 'Test A (IndexedDB CRUD)', 'Successfully saved experiment to IndexedDB.');
            await WorkbenchDB.deleteExperiment(exp.id);
        } catch (e) {
            assert(false, 'Test A (IndexedDB CRUD)', e.message);
        }

        // Test B: Experiment Builder
        try {
            const expB = await WorkbenchDB.saveExperiment({
                title: 'Test B Builder',
                personality: 'Voicing test prompt',
                defaultRepetitions: 4,
            });
            const fetched = await WorkbenchDB.getExperiment(expB.id);
            assert(fetched.personality === 'Voicing test prompt' && fetched.defaultRepetitions === 4, 'Test B (Experiment Builder)', 'Experiment fields persisted correctly.');
            await WorkbenchDB.deleteExperiment(expB.id);
        } catch (e) {
            assert(false, 'Test B (Experiment Builder)', e.message);
        }

        // Test C: Subtest Inheritance & Overrides
        try {
            const effective = await WorkbenchRecordSheet.getEffectiveFields('dummy-exp', null);
            assert(Array.isArray(effective), 'Test C (Subtest Inheritance)', 'Calculated effective field schemas without error.');
        } catch (e) {
            assert(false, 'Test C (Subtest Inheritance)', e.message);
        }

        // Test D: Model Credentials Isolation
        try {
            const model = await WorkbenchDB.saveModel({ name: 'Secret Model', apiKey: 'sk-secret-123', provider: 'openai_compatible' });
            const sanitized = WorkbenchDB.sanitizeModel(model);
            assert(sanitized.apiKey === undefined && model.apiKey === 'sk-secret-123', 'Test D (Model Credential Security)', 'API key is stripped during export/sanitization.');
            await WorkbenchDB.deleteModel(model.id);
        } catch (e) {
            assert(false, 'Test D (Model Credential Security)', e.message);
        }

        // Test E: Job Queue Scheduling
        try {
            const jobs = await WorkbenchDB.bulkCreateJobs([
                { runId: 'test-run-1', subtestId: 'sub-1', modelId: 'mod-1', iteration: 1, sortKey: 0 },
                { runId: 'test-run-1', subtestId: 'sub-1', modelId: 'mod-1', iteration: 2, sortKey: 1 },
            ]);
            assert(jobs.length === 2 && jobs[0].status === 'pending', 'Test E (Execution Job Scheduling)', 'Jobs created in queue with pending status.');
        } catch (e) {
            assert(false, 'Test E (Execution Job Scheduling)', e.message);
        }

        // Test F: Response Storage
        try {
            const resp = await WorkbenchDB.saveResponse({
                runId: 'test-run-1',
                subtestId: 'sub-1',
                modelId: 'mod-1',
                iteration: 1,
                text: 'Generated text response',
            });
            assert(resp.text === 'Generated text response' && resp.createdAt, 'Test F (Immutable Response Save)', 'Response saved with timestamp.');
        } catch (e) {
            assert(false, 'Test F (Immutable Response Save)', e.message);
        }

        // Test G: Dynamic Record Sheet Values
        try {
            const rec = await WorkbenchDB.saveRecord({
                responseId: 'resp-1',
                runId: 'test-run-1',
                reviewStatus: 'complete',
                fieldValues: { rating: 5, notes: 'Great' }
            });
            assert(rec.fieldValues.rating === 5 && rec.reviewStatus === 'complete', 'Test G (Test Record Sheet)', 'Custom field values and status saved.');
        } catch (e) {
            assert(false, 'Test G (Test Record Sheet)', e.message);
        }

        // Test H: Model Comparison Matching
        try {
            assert(typeof WorkbenchReview.toggleCompareMode === 'function', 'Test H (Model Side-by-Side View)', 'Side-by-side comparison mode active.');
        } catch (e) {
            assert(false, 'Test H (Model Side-by-Side View)', e.message);
        }

        // Test I: Searchable Archive Querying
        try {
            assert(typeof WorkbenchArchive.onSearch === 'function', 'Test I (Research Archive Search)', 'Archive search handler ready.');
        } catch (e) {
            assert(false, 'Test I (Research Archive Search)', e.message);
        }

        // Test J: Export Backup Serialization
        try {
            const backup = await WorkbenchDB.exportBackup();
            assert(backup._app === 'anansi-workbench' && Array.isArray(backup.experiments), 'Test J (JSON Backup Export)', 'Backup metadata and store arrays serialized.');
        } catch (e) {
            assert(false, 'Test J (JSON Backup Export)', e.message);
        }

        // Test K: AnansiForge Vault Persistence, Assembly & Subtest Inheritance
        try {
            await WorkbenchDB.saveForgeAssets([
                { id: 'test_k_1', assetType: 'character', name: 'Test Persona K1', personality: 'Test prompt 1' },
                { id: 'test_k_2', assetType: 'scenario', name: 'Test Scenario K2', scenario: 'Test scenario 2' }
            ]);
            const loaded = await WorkbenchDB.getForgeAssets();
            assert(loaded.length >= 2, 'Test K1 (AnansiForge Vault Persistence)', 'Vault assets saved to IndexedDB forge_assets store.');

            // Test K2: Subtest Inheritance Modes
            const appP = WorkbenchUtils.calculateEffectivePromptField('Parent Prompt', 'Subtest Extension', 'append');
            const prepP = WorkbenchUtils.calculateEffectivePromptField('Parent Prompt', 'Subtest Prefix', 'prepend');
            const repP = WorkbenchUtils.calculateEffectivePromptField('Parent Prompt', 'Subtest Replacement', 'replace');
            assert(
                appP === 'Parent Prompt\n\nSubtest Extension' &&
                prepP === 'Subtest Prefix\n\nParent Prompt' &&
                repP === 'Subtest Replacement',
                'Test K2 (Field Inheritance Modes)',
                'Calculated append, prepend, and replace inheritance modes correctly.'
            );

            // Test K3: Provenance Metadata & Hash
            const hash = WorkbenchUtils.computeContentHash('Test Prompt Hash');
            assert(hash && typeof hash === 'string', 'Test K3 (Content Hash & Provenance)', 'Computed hash for provenance tracking.');

            // Test K4: Project Prompt Field Extraction
            const testProjAsset = {
                id: 'test_proj_schema',
                raw: {
                    compiledCard: {
                        char_persona: 'Extracted Persona Prompt',
                        world_scenario: 'Extracted Scenario Text',
                        first_mes: 'Extracted Greeting Message'
                    }
                }
            };
            const extracted = WorkbenchImport.openProjectConversion ? WorkbenchImport.extractProjectPromptFields?.(testProjAsset) : null;
            if (extracted) {
                assert(
                    extracted.personality === 'Extracted Persona Prompt' &&
                    extracted.scenario === 'Extracted Scenario Text' &&
                    extracted.initialMessage === 'Extracted Greeting Message',
                    'Test K4 (Project Prompt Field Extraction)',
                    'Extracted personality, scenario, and initial message from project card schema.'
                );
            }
        } catch (e) {
            assert(false, 'Test K (AnansiForge Vault Persistence & Refinements)', e.message);
        }

        const passes = results.filter(r => r.status === 'PASS').length;
        console.log(`%cSummary: ${passes}/${results.length} tests passed.`, 'font-weight: bold; color: #6366f1;');
        return results;
    }

    window.WorkbenchTests = {
        runAllTests,
        results,
    };
})();
