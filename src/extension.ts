import * as vscode from 'vscode';
import axios, { CancelTokenSource } from 'axios';

const OLLAMA_HOST = 'http://localhost:11434';
const DEBOUNCE_DELAY = 5000; // 5 seconds

class AICodeProvider implements vscode.InlineCompletionItemProvider {
    private lastRequestSource: CancelTokenSource | null = null;
    private statusBarItem: vscode.StatusBarItem;
    private lastDocumentVersion = -1;

    constructor() {
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.statusBarItem.text = '$(sync~spin) AI Coding';
        this.statusBarItem.hide();
    }

    public async provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.InlineCompletionContext,
        token: vscode.CancellationToken
    ): Promise<vscode.InlineCompletionList> {
        // Cancel previous request
        if (this.lastRequestSource) {
            this.lastRequestSource.cancel('New request triggered');
            this.lastRequestSource = null;
        }

        return new Promise(async (resolve) => {
			
            const currentDocVersion = document.version;
            this.lastDocumentVersion = currentDocVersion;

            const source = axios.CancelToken.source();
            this.lastRequestSource = source;
			
            const timeout = setTimeout(async () => {
				console.log("This is the text going to AI:",document.getText());

				
                try {
                    this.statusBarItem.show();
                    this.statusBarItem.tooltip = 'Generating code suggestions...';

                    const response = await axios.post(`${OLLAMA_HOST}/api/generate`, {
                        model: 'deepseek-coder:6.7b',
						prompt: `[SYSTEM]
						You are a code completion expert. Follow these rules STRICTLY:
						1. Only respond if you see "//prompt:" in the code
						2. Generate ONLY the code requested after "//prompt:"
						3. Match existing indentation and style
						4. No explanations or comments
						5. Just provide code nothing else
						
						[USER CODE]
						${document.getText()}
						[/SYSTEM]`,
                        temperature: 0.7,
                        max_tokens: 150,
                        stream: false,
                        options: {
                            num_gpu: 0 // Set to 1 if you have enough VRAM
                        }
                    }, {
                        cancelToken: source.token,
                        timeout: 500000
                    });

                    if (currentDocVersion !== document.version) {
                        return resolve({ items: [] });
                    }

                    if (response.data.response?.trim()) {
						// Store the clean code and position
						const cleanCode = response.data.response
							.replace(/^```[\s\S]*?\n/, '')
							.replace(/\n```$/, '')
							.trim();
						
						const applyPosition = new vscode.Position(position.line, position.character);
						const docVersion = document.version;
					
						vscode.window.showInformationMessage('AI Suggestion Ready!', 'Apply')
							.then(selection => {
								if (selection === 'Apply') {
									const editor = vscode.window.activeTextEditor;
									if (editor && editor.document.version === docVersion) {
										editor.edit(editBuilder => {
											editBuilder.insert(applyPosition, cleanCode);
										});
									}
								}
							});
					
						resolve({
							items: [{
								insertText: cleanCode,
								range: new vscode.Range(position, position)
							}]
						});
					}
                } catch (error :any) {
                    if (!axios.isCancel(error)) {
                        vscode.window.showErrorMessage(`AI Error: ${error.response?.data?.error || error.message}`);
                    }
                    resolve({ items: [] });
                } finally {
                    this.statusBarItem.hide();
                    this.lastRequestSource = null;
                }
            }, DEBOUNCE_DELAY);

            token.onCancellationRequested(() => {
                clearTimeout(timeout);
                source.cancel('User cancellation');
                this.statusBarItem.hide();
                resolve({ items: [] });
            });
        });
    }

    dispose() {
        this.statusBarItem.dispose();
        if (this.lastRequestSource) {
            this.lastRequestSource.cancel('Extension disposed');
        }
    }
}

export function activate(context: vscode.ExtensionContext) {
    const provider = new AICodeProvider();
    
    context.subscriptions.push(
        vscode.languages.registerInlineCompletionItemProvider(
            { scheme: 'file', language: '*' },
            provider
        ),
        provider
    );
}