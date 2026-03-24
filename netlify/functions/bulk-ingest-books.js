/**
 * Netlify Function: bulk-ingest-books
 * POST /api/bulk-ingest-books
 * Feeds entire negotiation books to ARCHI's knowledge base.
 * Books: art_of_the_deal, never_split, influence, getting_to_yes, 48_laws, getting_more, all
 */

import { getSupabaseAdmin, getDB, handleOptions } from './fnUtils.js'

let _db
function getDB() { return (_db ??= getSupabaseAdmin()) }

// -----------------------------------------------------------------------
// BOOK 1: TRUMP  THE ART OF THE DEAL
// -----------------------------------------------------------------------
const ART_OF_THE_DEAL = [
    {
        title: 'Art of the Deal  11 Core Principles of Deal Making',
        source_type: 'research',
        domain_tags: ['Negotiation', 'Deal Making', 'Strategy', 'General'],
        content_text: `TRUMP: THE ART OF THE DEAL  THE 11 ELEMENTS OF THE DEAL

PRINCIPLE 1: THINK BIG  Open with extreme, ambitious positions. Anchoring high resets expectations. Bold openings signal power. Open 30-50% beyond target. When they negotiate you down to your real target, they feel they won.

PRINCIPLE 2: PROTECT THE DOWNSIDE  Always calculate worst-case. Build in escape clauses and fallback positions. When downside is protected, you negotiate with freedom. Always have your BATNA defined before entering.

PRINCIPLE 3: MAXIMIZE OPTIONS  Keep multiple deals in play simultaneously. Having options creates competition. Never signal this is your only deal. Always imply alternatives.

PRINCIPLE 4: KNOW YOUR MARKET  First-hand intelligence beats reports. Ask questions relentlessly. The negotiator who knows more wins. Deep-research counterparty, their company, financial position, and alternatives.

PRINCIPLE 5: USE YOUR LEVERAGE  Never appear desperate. Calm, unhurried, almost indifferent projects maximum strength. Leverage comes from having what they need, having alternatives, understanding their deadline while hiding yours.

PRINCIPLE 6: ENHANCE PERCEIVED VALUE  Presentation and framing shape value perception. Frame proposals in terms of what they gain, not what they pay.

PRINCIPLE 7: GET THE WORD OUT  Control narrative before negotiation begins. Reference external validation. Pre-anchor through third-party credibility.

PRINCIPLE 8: FIGHT BACK  Never absorb lowballs without responding. Immediate firm pushback establishes boundaries. Re-anchor to your extreme. Never negotiate from their number.

PRINCIPLE 9: DELIVER THE GOODS  Reputation is your longest-term asset. Credibility compounds. Only commit to what you can deliver.

PRINCIPLE 10: CONTAIN THE COSTS  Track every concession. Maintain concession ledger. Make asymmetry explicit.

PRINCIPLE 11: HAVE FUN  Detachment from outcome creates freedom. The stressed negotiator concedes to end stress. The engaged negotiator makes moves to win.`
    }
]

// -----------------------------------------------------------------------
// BOOK 2: NEVER SPLIT THE DIFFERENCE  Chris Voss (FBI Hostage Negotiator)
// -----------------------------------------------------------------------
const NEVER_SPLIT = [
    {
        title: 'Never Split the Difference  Core FBI Negotiation Toolkit (Chris Voss)',
        source_type: 'research',
        domain_tags: ['Negotiation', 'Psychology', 'FBI', 'Persuasion', 'General'],
        content_text: `NEVER SPLIT THE DIFFERENCE  CHRIS VOSS  FBI HOSTAGE NEGOTIATION APPLIED TO BUSINESS

THE FOUNDATIONAL PRINCIPLE: Negotiation is not about logic or being right. It's about making the other person feel heard, then strategically directing the conversation.

TACTIC 1: TACTICAL EMPATHY
What: Demonstrating understanding of the counterparty's perspective and feelings WITHOUT agreeing with them.
Mechanism: When people feel understood, their guard drops. They become more collaborative. This is not sympathy  it's intelligence gathering disguised as emotional connection.
Application: "It seems like you're under a lot of pressure on the timeline." This validates their emotion without conceding anything. They'll often reveal WHY they're pressured  which is intelligence you can use.
Key rule: Label emotions before asking for things. Always.

TACTIC 2: MIRRORING
What: Repeating the last 1-3 critical words the counterparty said, with an upward inflection.
Mechanism: Triggers the other person to elaborate and clarify. They feel heard while giving you more information. Creates bonding through similarity.
Application: They say "We can't go above $50K because of our budget constraints." You mirror: "Budget constraints?" They'll then explain exactly what their budget situation is  which reveals their real ceiling and flexibility.
Key rule: Mirror the most information-rich words, not filler words.

TACTIC 3: LABELING
What: Identifying and verbalizing the counterparty's emotions or positions using "It seems like..." or "It sounds like..."
Mechanism: Defuses negative emotions, reinforces positive ones. Labels that describe feelings reduce their intensity. Labels that describe fair treatment increase cooperation.
Application: "It seems like fairness is really important to you in this deal." Once they agree, you've established a frame  now ANY proposal you make that's structured as "fair" has pre-built acceptance.
Negative label: "It seems like you think we're trying to take advantage of you." This forces them to either agree (which you can address) or deny (which puts them in a more collaborative stance).

TACTIC 4: THE ACCUSATION AUDIT
What: Pre-emptively listing every terrible thing the counterparty could think about you or your position BEFORE they say it.
Mechanism: Takes the sting out of negatives by addressing them first. When you say the worst things about yourself, they can't use those against you. They'll often soften: "No, it's not THAT bad."
Application: "You're probably thinking that this price is too high, that we're being greedy, and that you could find someone cheaper. And you might be right about the cheaper part." Now their objections are neutralized before they're even raised.
Key rule: Go further than you're comfortable with. The more extreme the audit, the more they'll pull back toward reasonableness.

TACTIC 5: THE CALIBRATED QUESTION ("How/What" Questions)
What: Open-ended questions starting with "How" or "What" that force the counterparty to solve YOUR problem.
Mechanism: Gives them the illusion of control while you direct the conversation. Makes them do the mental work of finding solutions that work for both sides.
Application:
- "How am I supposed to do that?" (when they make an unreasonable demand  makes THEM justify it)
- "What does this look like from my perspective?"
- "How can we solve this together?"
- "What happens if we can't reach agreement?"
FORBIDDEN: Questions starting with "Why"  these trigger defensiveness. "Why did you do that?" feels like an accusation. "What caused that?" is the same question without the attack.

TACTIC 6: THE F-WORD (FAIR)
What: Using "fair" as a strategic weapon.
Mechanism: "Fair" is the most powerful word in any negotiation because nobody wants to be seen as unfair.
Three uses:
1. DEFENSIVE (they use it): "We just want what's fair." This is manipulative. Counter: "I apologize. Let me go back to where I was unfair, and I'll fix it." This calls their bluff.
2. PROACTIVE (you set the frame): "I want you to feel like you've been treated fairly at all times. If at any point you feel I'm being unfair, please stop me." Now they can never claim unfairness without looking dishonest.
3. OFFENSIVE: "We've given you a fair offer." Only use if your position is genuinely strong.

TACTIC 7: ANCHORING WITH THE ACKERMAN MODEL
What: A precise system for making offers with calibrated concessions.
Steps:
1. Set your target price.
2. Your first offer is 65% of target.
3. Calculate three raises of decreasing increments: 85%, 95%, 100%.
4. Use empathy and calibrated questions between each increase.
5. On your final number, use a precise, non-round number ($97,325 not $97,000). Precise numbers feel researched and non-negotiable.
6. On the final offer, throw in a non-monetary item they don't want  to show you're at your limit.
Application: Target is $100K. Open at $65K. Move to $85K ("We really stretched to get here"). Move to $95K with a calibrated question. Final offer: $97,825 with something non-monetary ("and we'll include the annual audit at no charge").

TACTIC 8: "NO" IS THE START, NOT THE END
What: Getting to "no" is actually the goal, not getting to "yes."
Mechanism: People feel safe and in control when they say no. A pressured "yes" is a fake yes. A genuine "no" establishes a boundary  and once they've drawn their boundary, they relax and become more collaborative.
Application: Instead of "Do you agree this is fair?" ask "Is it ridiculous to think we could find a solution here?" They say "No, it's not ridiculous"  which is actually a yes disguised as a no.
Key technique: "Have you given up on this project?" Forces a "No" that commits them to continuing.

TACTIC 9: "THAT'S RIGHT" vs. "YOU'RE RIGHT"
"That's right" = breakthrough. They feel genuinely understood. Deals close after "that's right."
"You're right" = brush-off. They're just trying to end the conversation. Nothing will follow.
How to get "that's right": Summarize their position so perfectly that they have no choice but to agree with your summary. Use labels + paraphrasing until they say it.

TACTIC 10: BLACK SWANS
What: Unknown unknowns  pieces of information that, if discovered, completely change the negotiation.
Every negotiation has 3-5 black swans. Your job is to find them.
Examples: They have a deadline you don't know about. They have a competing offer. Their boss is pressuring them. They're about to get fired. They need THIS deal for personal reasons.
How to find them: Listen for off-hand comments, emotional flares, over-justification on specific topics. Black swans hide in the things people say too much about or avoid entirely.`
    },
    {
        title: 'Never Split the Difference  Advanced Tactics and Hostage Negotiation Case Studies (Chris Voss)',
        source_type: 'historical',
        domain_tags: ['Negotiation', 'FBI', 'Case Study', 'Psychology', 'Strategy'],
        content_text: `NEVER SPLIT THE DIFFERENCE  ADVANCED TACTICS & REAL-WORLD APPLICATION

LESSON: NEVER SPLIT THE DIFFERENCE (The Core Philosophy)
Compromise is lazy and often leaves both parties worse off. If someone has your child and you want them back, splitting the difference means getting half a child. The lesson: in negotiations that matter, don't default to the middle. Win the terms that matter most.
Application: When they say "Let's just meet in the middle," respond: "I appreciate the spirit of compromise, but the middle doesn't work for either of us. Let me explain why our number actually serves your interests better."

THE LATE-NIGHT FM DJ VOICE
Technique: Slow down. Drop your vocal pitch. Speak more deliberately.
Why: A calm, low, deliberate voice has an automatic calming effect on the listener. It conveys authority and control without aggression.
Application in email: The written equivalent is shorter sentences, calm phrasing, no exclamation marks, no urgency language. Every sentence should feel measured.

THE 7-38-55 RULE (Mehrabian)
Only 7% of communication is words. 38% is tone. 55% is body language.
In email negotiation: This means word choice and sentence structure carry ALL the weight. Every word must be intentional. Short declarative sentences project confidence. Long explanatory sentences project anxiety.

CASE STUDY: HAITI KIDNAPPING (2006)
Situation: Man kidnapped in Haiti. kidnappers demanded $150,000.
Voss's approach:
1. Used labeling to establish rapport with the kidnappers
2. Asked calibrated questions: "How can I pay that when we don't have that kind of money?"
3. Made the kidnappers solve the money problem themselves
4. Used the Ackerman model: Started at $3,000, moved to $4,751 (precise number), then $6,500, final at $4,751 again
5. Kidnapper accepted $4,751  a 97% reduction from the opening demand
Lessons:
- Extreme anchoring works even in life-or-death situations
- Precise numbers signal that you've calculated carefully and can't go higher
- Making THEM solve YOUR problem shifts the dynamic entirely
- Patience wins. The negotiation took days while the kidnappers expected hours.

CASE STUDY: SALARY NEGOTIATION (Chapter 10)
Voss's student negotiated a $12,000 raise using these steps:
1. Accusation audit: "You probably think I'm about to make an unreasonable ask..."
2. Anchored with a non-monetary request first (better title), making the salary ask feel reasonable by comparison
3. Used calibrated questions: "What does it take for someone in this role to get a raise here?"
4. Got the manager to describe the path  then positioned herself as already meeting those criteria
5. Used "seems like" labels to acknowledge the manager's constraints
6. Ended with a precise number based on market research
Lessons:
- Lead with non-monetary asks to set a collaborative frame
- Make them describe the criteria, then show you already meet them
- Never give a range  ranges tell them the lowest number you'll accept

THE CHRIS VOSS DECISION TREE FOR EMAIL NEGOTIATION:
1. Their first message ? Mirror the key terms + label their emotion
2. They make a demand ? Calibrated question: "How am I supposed to do that?"
3. They anchor high ? Accusation audit + your counter-anchor with Ackerman
4. They threaten walkaway ? Label: "It seems like you feel this isn't worth your time" (forces them to disagree)
5. They go silent ? "Have you given up on this?" (forces a committed "no")
6. They say "be reasonable" ? "I want to be. Help me understand what reasonable looks like from your side."
7. They involve a third party ? "What does [third party] need to see to approve this?"
8. Deal seems close ? Summarize everything until they say "That's right"
9. Final concession ? Ackerman precise number + non-monetary add-on`
    }
]

// -----------------------------------------------------------------------
// BOOK 3: INFLUENCE  Robert Cialdini (6 Principles of Persuasion)
// -----------------------------------------------------------------------
const INFLUENCE = [
    {
        title: 'Influence: The Psychology of Persuasion  7 Principles of Persuasion (Robert Cialdini)',
        source_type: 'research',
        domain_tags: ['Persuasion', 'Psychology', 'Negotiation', 'Influence', 'General'],
        content_text: `INFLUENCE: THE PSYCHOLOGY OF PERSUASION  ROBERT CIALDINI  7 WEAPONS OF INFLUENCE

These are the 7 psychological triggers that drive human compliance. Every negotiation involves at least 3 of them.

PRINCIPLE 1: RECIPROCITY
Mechanism: When someone gives us something, we feel an overwhelming urge to give back. This is hardwired  violating reciprocity triggers social punishment.
Exploitation in negotiation: Make a concession (even a fake one) and the counterparty will feel compelled to reciprocate. Give them something BEFORE you ask for something.
Application: "We've done X for you already" or "As a gesture of good faith, we're willing to..." Then make your big ask. The reciprocity obligation makes refusal psychologically painful.
Defense: Recognize the tactic. Ask yourself: "Am I agreeing because it's a good deal, or because I feel obligated?" Favor reciprocation is not the same as obligation.
ADVANCED: The rejection-then-retreat technique. Ask for something extreme (which gets rejected), then "retreat" to what you actually wanted. The retreat feels like a concession, triggering reciprocity.

PRINCIPLE 2: COMMITMENT AND CONSISTENCY
Mechanism: Once people take a position or make a commitment, they feel internal pressure to behave consistently with that commitment. We all want to appear consistent  inconsistency signals untrustworthiness.
Exploitation: Get small yeses before big asks. Once they've agreed to a small thing, they'll agree to larger things to stay consistent.
Application: "Do you agree that quality matters in this type of work?" (Yes.) "Do you agree that cutting corners can be costly?" (Yes.) "Then you'd agree our premium approach is the right fit." Each yes builds commitment chain.
Defense: Ask yourself: "Would I make this same choice if I were starting fresh?" Don't let past commitments trap you in bad deals.
ADVANCED: Written commitments are far more binding than verbal ones. If they agree to a term, get it in writing immediately. Once written, people almost never reverse.

PRINCIPLE 3: SOCIAL PROOF
Mechanism: We look to others' behavior to determine correct behavior, especially in uncertain situations.
Exploitation: "Other companies in your industry have chosen our approach" or "The market consensus is..." or "83% of similar deals in this range close at X."
Application: Reference other deals, industry standards, published benchmarks. When they don't know what "fair" looks like, YOU define it with social proof.
Defense: Check if the social proof is real or manufactured. "Which companies specifically?" calls the bluff.
ADVANCED: Testimonials from similar situations are 10x more persuasive than general statistics. "A company your size, in your industry, with the same concern, chose this approach and saw Y result."

PRINCIPLE 4: AUTHORITY
Mechanism: We defer to experts and authority figures, often bypassing our own judgment.
Exploitation: Establish credibility before negotiating. Reference credentials, experience, titles, published work, media appearances. The more expert you appear, the less they question your positions.
Application: "Based on our 15 years in this space..." or "Our analysis, consistent with [industry authority], shows..." Position yourself as the expert on value.
Defense: Ask: "Is this person actually an expert in THIS specific domain?" Authority in one field doesn't transfer to another.
ADVANCED: Authority signals include confidence in delivery, specificity of language (experts use precise terms, not generalities), and willingness to acknowledge limitations (which paradoxically increases credibility).

PRINCIPLE 5: LIKING
Mechanism: We say yes to people we like. Liking is driven by: similarity, compliments, cooperation, physical attractiveness, and association with positive things.
Exploitation: Find genuine common ground before negotiating substance. Compliment specifically, not generically. Frame the negotiation as a collaborative problem-solving exercise.
Application: "I really respect how you've handled this situation" or "We're both trying to find something that works" or "I can see you've put a lot of thought into this."
Defense: Separate the PERSON from the DEAL. Like them all you want  evaluate the terms independently.
ADVANCED: The most powerful liking trigger is being the bearer of good news. Start every interaction with something positive before addressing difficult terms.

PRINCIPLE 6: SCARCITY
Mechanism: Things become more valuable when they're rare or about to become unavailable. Loss aversion means losing something hurts 2x more than gaining the same thing feels good.
Exploitation: "This offer expires on Friday" or "We have one slot remaining" or "If we can't finalize this week, we'll need to reevaluate the terms."
Application: Frame your proposal as LIMITED  limited time, limited availability, limited patience.
Defense: Test every scarcity claim. "What specifically changes after Friday?" Most deadlines are manufactured.
ADVANCED: Exclusive information is the most persuasive form of scarcity. "I probably shouldn't tell you this, but..." makes information feel scarce AND triggers reciprocity.

PRINCIPLE 7: UNITY (from Pre-Suasion)
Mechanism: We comply most with people we consider part of our group  our tribe, our industry, our identity.
Exploitation: Establish shared identity before negotiating. "As fellow [industry members / entrepreneurs / parents / professionals]..." or "We're in the same boat here."
Application: Use "we" language. Frame the negotiation as an internal problem two allies are solving, not an adversarial contest.
Defense: Recognize when "we" language is being used to blur the fact that your interests are actually opposed.`
    }
]

// -----------------------------------------------------------------------
// BOOK 4: GETTING TO YES  Fisher & Ury (Harvard Negotiation Project)
// -----------------------------------------------------------------------
const GETTING_TO_YES = [
    {
        title: 'Getting to Yes  Principled Negotiation Framework (Fisher, Ury, Patton  Harvard)',
        source_type: 'research',
        domain_tags: ['Negotiation', 'Harvard', 'Strategy', 'Principled', 'General'],
        content_text: `GETTING TO YES  FISHER, URY, PATTON  THE 4 PRINCIPLES OF PRINCIPLED NEGOTIATION

This is the foundational text of modern negotiation theory from Harvard's Program on Negotiation.

PRINCIPLE 1: SEPARATE THE PEOPLE FROM THE PROBLEM
Every negotiation has two levels: the substantive issue and the relationship between the people. Mixing them is fatal.
Mechanism: When people feel attacked personally, they defend their ego instead of the issue. This makes them rigid. When you separate the person from the problem, they can give ground on the issue without losing face.
Application:
- Never say "Your offer is ridiculous." Say "This offer doesn't work for our situation."
- Never say "You're being unreasonable." Say "Help me understand the reasoning behind these terms."
- Attack the problem, praise the person: "I really value our relationship, which is why I want to be transparent about these numbers."
Advanced: If they attack YOU personally, redirect: "Let's not let this negotiation damage what's been a great professional relationship. Let's focus on the terms."

PRINCIPLE 2: FOCUS ON INTERESTS, NOT POSITIONS
A position is WHAT someone says they want. An interest is WHY they want it. Positions are often incompatible. Interests usually aren't.
Classic example: Two siblings fight over an orange (positions conflict). One wants the peel for baking, one wants the juice (interests are compatible  both can get 100% of what they actually need).
Application:
- When they state a position, ask "Why is that important to you?" or "What problem does that solve?"
- Your interests should be stated, not just your positions: "We need this contract length because we're investing heavily in customization for you."
- Behind opposed positions often lie shared interests: both want the deal to succeed, both want to avoid litigation, both want to preserve the relationship.
Advanced: The most powerful interests are human needs: security, economic well-being, belonging, recognition, control. Address THESE and positions become flexible.

PRINCIPLE 3: INVENT OPTIONS FOR MUTUAL GAIN
Most negotiations are treated as fixed-pie: whatever one side gains, the other loses. In reality, the pie can almost always be expanded.
Mechanism: Creative options that satisfy both sides' underlying interests can transform adversarial negotiations into collaborative ones.
Application:
- "What if we structure this differently?"  propose variations on deal structure
- Trade things that are cheap for you but valuable to them (and vice versa)
- "What if we split this into two agreements?" separating the easy from the hard
- Contingency agreements: "If X happens, we'll do Y. If it doesn't, we'll do Z." This resolves disagreements about future uncertainty.
Brainstorming rule: Generate options first, evaluate them second. Evaluating too early kills creativity.
Advanced: Dovetailing  when their interests differ from yours, there's often a creative combination that satisfies both. Look for differences in: priorities, beliefs about the future, risk tolerance, time preferences.

PRINCIPLE 4: INSIST ON OBJECTIVE CRITERIA
When subjective arguing fails, objective standards provide a framework both sides can accept without losing face.
Mechanism: "Let's look at what the market says" or "What does the industry standard say?" Neither side has to bend to the other's will  both bend to the same objective standard.
Application:
- Market value, precedent, scientific data, professional standards, equal treatment, tradition, reciprocity  all are objective criteria.
- "What criteria did you use to arrive at that number?" If they can't point to an objective standard, their position is exposed as arbitrary.
- Your own proposals should always reference objective criteria: "Based on the Zillow estimate / ComparableS / Glassdoor data / industry benchmark..."
Defense against power plays: "I'm open to being persuaded on the basis of principle, not pressure."

THE BATNA FRAMEWORK
BATNA = Best Alternative to a Negotiated Agreement. This is the single most important concept in negotiation theory.
- The stronger your BATNA, the stronger your negotiating position.
- NEVER enter a negotiation without knowing your BATNA.
- If their offer is worse than your BATNA, walk away. Period.
- Improve your BATNA before the negotiation and your position improves automatically.
- Know THEIR BATNA too  if theirs is weak, you have leverage.
APPLICATION: Before sending any negotiation email, answer: "What happens if this deal falls through entirely?" If the answer is "catastrophe," you need to strengthen your BATNA first.

NEGOTIATION JUJITSU (When They Won't Play Along)
When the counterparty uses positional bargaining (hardball, threats, takebacks):
1. Don't push back  redirect. Ask "Why?" and "Why not?" to uncover interests behind positions.
2. Don't defend your ideas  invite criticism. "What's wrong with this approach?" shifts them from attacking to problem-solving.
3. Reframe attacks on you as attacks on the problem: "I can see you're frustrated with the pace. Let's figure out how to accelerate this."
4. Use silence. After making a reasonable proposal, stop talking. Let them fill the gap.`
    }
]

// -----------------------------------------------------------------------
// BOOK 5: THE 48 LAWS OF POWER  Robert Greene (Negotiation-Critical Laws)
// -----------------------------------------------------------------------
const LAWS_OF_POWER = [
    {
        title: '48 Laws of Power  Negotiation-Critical Laws and Applications (Robert Greene)',
        source_type: 'research',
        domain_tags: ['Power', 'Strategy', 'Psychology', 'Negotiation', 'General'],
        content_text: `THE 48 LAWS OF POWER  ROBERT GREENE  NEGOTIATION-CRITICAL LAWS

The laws most directly applicable to negotiation, with tactical applications.

LAW 1: NEVER OUTSHINE THE MASTER
In negotiation: Let the counterparty feel smart and in control. Make them feel like the deal was their idea. People who feel outmaneuvered become vindictive and kill deals. The best deals are ones where they feel they won.
Application: "That's a great point  what if we built on that idea and..." even when proposing your own solution.

LAW 3: CONCEAL YOUR INTENTIONS
Never reveal your real priorities. If they know your #1 need, they'll extract maximum concessions for it. Negotiate multiple issues simultaneously so they can't identify your must-haves.
Application: Fight equally hard for things you don't care about. Concede them "reluctantly" in exchange for what you actually need.

LAW 4: ALWAYS SAY LESS THAN NECESSARY
The more you say, the more ammunition you give them. Short responses project power. Verbose responses project anxiety. In email: shorter is stronger.
Application: After making an offer, stop writing. Don't explain, don't justify, don't fill the silence. "Our offer is X. We believe it reflects the value accurately."

LAW 5: SO MUCH DEPENDS ON REPUTATION  GUARD IT WITH YOUR LIFE
Your negotiating reputation precedes you. If you're known as someone who delivers, your word carries weight. If you're known as someone who bluffs, nothing you say matters.
Application: Deliver on every commitment. Never make a threat you won't follow through on.

LAW 6: COURT ATTENTION AT ALL COSTS
In negotiation: The party who controls the narrative wins. Frame the discussion. Set the agenda. Whoever defines the terms of the conversation has already shaped the outcome.
Application: Open every negotiation by defining the agenda yourself. "Here's what I think we should discuss today."

LAW 8: MAKE OTHER PEOPLE COME TO YOU
In negotiation: The person who requests the meeting is in a weaker position. Make them reach out. Make them send the first proposal. The person who acts first reveals more.
Application: After initial contact, let them send the first number. Let them propose the meeting time. Small signals of initiative reveal eagerness.

LAW 11: LEARN TO KEEP PEOPLE DEPENDENT ON YOU
Create value that only you can provide. The more dependent they are on your specific expertise, product, or relationship, the stronger your position.
Application: Emphasize the switching costs of choosing someone else. "Based on your specific needs, we've already invested in understanding your situation..."

LAW 15: CRUSH YOUR ENEMY TOTALLY
In negotiation: When you have decisive leverage, use it completely. Don't leave residual power that can be used against you later. A half-won negotiation often becomes a full loss.
Application: If their position is weak, extract ALL the value now. Don't leave favorable terms "for next time." Next time, their position may be stronger.

LAW 16: USE ABSENCE TO INCREASE RESPECT AND HONOR
In negotiation: Strategic withdrawal increases your perceived value. If you're always available, you seem desperate. Disappear strategically.
Application: Don't respond to every email immediately. After making a strong offer, go silent for 48 hours. Let the pressure build.

LAW 17: KEEP OTHERS IN SUSPENDED TERROR  CULTIVATE AN AIR OF UNPREDICTABILITY
In negotiation: If they can predict your next move, they can counter it. Vary your approach. Sometimes be warm, sometimes be cold. Sometimes move fast, sometimes slow.
Application: Don't establish response-time patterns they can game.

LAW 28: ENTER ACTION WITH BOLDNESS
Timidity signals weakness. If you're going to make an offer, make it confidently. Half-hearted proposals invite counter-attacks.
Application: Never say "I was thinking maybe we could..." Say "Our position is X."

LAW 29: PLAN ALL THE WAY TO THE END
Know what the final deal should look like before you start. Work backward from the ending to determine each move. Most negotiators think one move ahead. Think five.
Application: Before drafting ANY email, define: "What does the final signed agreement look like?" Then make every move serve that end state.

LAW 33: DISCOVER EACH PERSON'S THUMBSCREW
Everyone has a weakness, a need, a pressure point. Find it and you control the negotiation. It might be ego, might be timeline, might be a boss they're trying to impress.
Application: Ask exploratory questions until you find what they REALLY need. Then position your offer as the solution to THAT need.

LAW 36: DISDAIN THINGS YOU CANNOT HAVE  IGNORING IS POWER
What you pay attention to, you give power. If they offer something terrible, don't fight it  dismiss it entirely. "Let's set that aside and focus on the terms that matter."
Application: Never dignify an absurd offer with extended analysis. Acknowledge it with one sentence and redirect.

LAW 42: STRIKE THE SHEPHERD AND THE SHEEP WILL SCATTER
Find the real decision-maker. Negotiating with subordinates wastes time and reveals your position. Always ask: "Who else will need to approve this?"
Application: "I want to make sure we're not going back and forth unnecessarily. Are you the final decision-maker on this?"

LAW 44: DISARM AND INFURIATE WITH THE MIRROR EFFECT
People are uncomfortable with their own behavior reflected back at them. If they're being unreasonable, mirror their exact approach. They'll either escalate (revealing irrationality) or moderate.
Application: If they send you a lowball, send them one back of equal absurdity. "If we're starting from aspirational numbers, here's ours."

LAW 47: DO NOT GO PAST THE MARK YOU AIMED FOR  IN VICTORY, LEARN WHEN TO STOP
The most dangerous moment is after winning. Over-reaching creates resentment, burns bridges, and often causes the other party to walk away entirely.
Application: When you've gotten your target terms, stop pushing. Close the deal. The extra 2% isn't worth the risk of losing everything.`
    }
]

// -----------------------------------------------------------------------
// BOOK 6: GETTING MORE  Stuart Diamond (Wharton's #1 Negotiation Course)
// -----------------------------------------------------------------------
const GETTING_MORE = [
    {
        title: 'Getting More  12 Strategies from the World\'s Most Popular Negotiation Course (Stuart Diamond, Wharton)',
        source_type: 'research',
        domain_tags: ['Negotiation', 'Wharton', 'Strategy', 'Business', 'General'],
        content_text: `GETTING MORE  STUART DIAMOND  12 KEY NEGOTIATION STRATEGIES FROM WHARTON

Diamond's approach is radically different from hardball tactics. His thesis: the best negotiators focus on the OTHER person, not on leverage and power.

STRATEGY 1: GOALS ARE PARAMOUNT  NOT WHO'S RIGHT
Being right is irrelevant if you don't get what you want. Every action in a negotiation should serve your stated goal. If arguing a point doesn't advance your goal, don't argue it.
Application: Before every email, ask: "Does this sentence move me closer to my goal, or does it just feel satisfying to write?"

STRATEGY 2: IT'S ABOUT THEM
The most critical information is what's inside THEIR head. Their perceptions, their emotions, their needs. Not the facts. Not the market. Not your position. THEM.
Application: Start every negotiation by understanding their world first. "Help me understand your situation" before ANY proposal.

STRATEGY 3: MAKE EMOTIONAL PAYMENTS
People are not rational. They make decisions based on emotion and justify with logic. If you want them to move, you must first address their emotional state.
Application: If they're angry, acknowledge the anger before discussing terms. "I can see you're frustrated with how this has gone." This costs nothing and buys enormous goodwill.

STRATEGY 4: EVERY SITUATION IS DIFFERENT
Templates fail. Each negotiation has unique people, context, constraints, and history. The approach that worked last time may not work this time.
Application: Don't apply a tactic because it's in a playbook. Apply it because the specific signals in THIS situation call for it.

STRATEGY 5: INCREMENTAL IS BEST
Don't try to solve everything in one big move. Small steps build momentum and trust. Each small agreement creates a foundation for the next.
Application: If the full deal seems stuck, ask: "What CAN we agree on right now?" Build from there. Partial agreements create commitment and momentum.

STRATEGY 6: TRADE THINGS OF UNEQUAL VALUE
The magic of negotiation: things that cost you little may be worth a lot to them, and vice versa. Find these asymmetries and trade across them.
Application: "What matters most to you in this deal?" Then offer that thing in exchange for what matters most to YOU. Both sides get high value at low cost.

STRATEGY 7: FIND THEIR STANDARDS AND USE THEM
People want to be consistent with their own stated values and policies. If you can find their standards and show that your request is consistent with THEIR principles, they can't deny you without being inconsistent.
Application: "Your company's public commitment to vendor partnerships seems to exactly align with our proposal." Now saying no contradicts their own stated values.

STRATEGY 8: BE TRANSPARENT AND CONSTRUCTIVE
Deception shortens negotiation lifespans. In repeat interactions (most business negotiations), transparency builds compound trust that is far more valuable than any single tactical win.
Application: "I'll be straight with you: our ideal outcome is X. Our minimum is Y. What does your range look like?" This is risky with adversarial counterparties but powerful with collaborative ones.

STRATEGY 9: ALWAYS COMMUNICATE, STATE YOUR VISION, AND FRAME
How you describe the negotiation shapes how both sides think about it. "We're trying to solve a problem together" creates very different dynamics than "We're trying to get the best deal."
Application: Frame every interaction as collaborative problem-solving, even when it's adversarial underneath. "How can we structure this so it works for both of us?"

STRATEGY 10: FIND THE REAL PROBLEM  AND THE REAL DECISION-MAKER
The stated problem is rarely the real problem. The stated decision-maker is rarely the real decision-maker.
Application: "What's really standing in the way of us moving forward?" often reveals constraints that aren't on the table. And: "Who else needs to be comfortable with this decision?"

STRATEGY 11: EMBRACE DIFFERENCES
Differences in priorities, risk tolerance, beliefs about the future, and time preferences create opportunities for trades that make both sides better off.
Application: If they want speed and you want price, trade: give them a faster timeline in exchange for a better price. The difference in what you each value IS the deal.

STRATEGY 12: PREPARE  MAKE A LIST AND PRACTICE
The most underrated negotiation skill: preparation. Diamond's students who prepare a physical list of tactics, goals, and counterparty intel outperform unprepared students by 2x even with identical skills.
Application: Before any negotiation email: write down (1) your goal, (2) their likely goal, (3) their emotional state, (4) your three best arguments, (5) their likely three best arguments, (6) your BATNA, (7) trade opportunities.`
    }
]

// -----------------------------------------------------------------------

const BOOK_MAP = {
    art_of_the_deal: ART_OF_THE_DEAL,
    never_split: NEVER_SPLIT,
    influence: INFLUENCE,
    getting_to_yes: GETTING_TO_YES,
    '48_laws': LAWS_OF_POWER,
    getting_more: GETTING_MORE,
}

export const handler = async (event) => {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' }
    if (event.httpMethod === 'OPTIONS') return handleOptions()


    let body = {}
    try { body = JSON.parse(event.body || '{}') } catch {}

    const bookKey = body.book || 'all'
    let chapters = []

    if (bookKey === 'all') {
        for (const k of Object.keys(BOOK_MAP)) chapters.push(...BOOK_MAP[k])
    } else if (BOOK_MAP[bookKey]) {
        chapters = BOOK_MAP[bookKey]
    } else {
        return { statusCode: 400, body: JSON.stringify({ error: `Unknown book. Available: ${Object.keys(BOOK_MAP).join(', ')}, all` }) }
    }

    const results = []
    for (const ch of chapters) {
        try {
            const { data: source, error: insertErr } = await getDB()
                .from('knowledge_sources')
                .insert({
                    title: ch.title,
                    source_type: ch.source_type,
                    domain_tags: ch.domain_tags,
                    content_text: ch.content_text,
                })
                .select().single()

            if (insertErr) {
                results.push({ title: ch.title, error: insertErr.message })
                continue
            }

            // Auto-process (fire-and-forget)
            fetch(`${process.env.URL}/.netlify/functions/process-knowledge`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.ARCHI_API_KEY}`,
            },
                body: JSON.stringify({ knowledge_id: source.id }),
            }).catch(() => {})

            results.push({ title: ch.title, source_id: source.id, chars: ch.content_text.length, status: 'processing' })
        } catch (err) {
            results.push({ title: ch.title, error: err.message })
        }
    }

    return {
        statusCode: 200,
        body: JSON.stringify({ book: bookKey, chapters_ingested: results.length, results }),
    }
}
