const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, 'public', 'js');

fs.readdirSync(dir).forEach(file => {
    if (file.endsWith('.js') && file !== 'reports_adv.js') {
        const filePath = path.join(dir, file);
        let content = fs.readFileSync(filePath, 'utf8');
        let original = content;

        content = content.replace(/class=\"premium-tabs\"/g, 'class="tabs"');
        content = content.replace(/class=\"premium-tabs /g, 'class="tabs ');
        
        content = content.replace(/class=\"premium-tab\"/g, 'class="tab"');
        content = content.replace(/class=\"premium-tab /g, 'class="tab ');
        
        content = content.replace(/\.querySelectorAll\(['"]\.premium-tab['"]\)/g, '.querySelectorAll(".tab")');
        
        if (content !== original) {
            fs.writeFileSync(filePath, content, 'utf8');
            console.log('Reverted ' + file);
        }
    }
});
